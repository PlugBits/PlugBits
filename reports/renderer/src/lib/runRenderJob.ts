import { getFonts } from '../fontStore.js';
import { logRendererError, logRendererInfo } from '../logging.js';
import { renderTemplateToPdf, type RenderPipelineStage } from '../render/renderTemplateToPdf.js';
import type {
  RendererErrorCode,
  RendererInlineAsset,
  RendererJobResultRequest,
  StoredRenderJobPayload,
} from '../shared/rendering.js';
import {
  fetchAssetBytes,
  fetchRenderJobPayload,
  resolveWorkerInternalTimeoutMs,
  transitionRenderJob,
  updateRenderJobResult,
  uploadRenderedPdf,
} from '../workerClient.js';

const RENDERER_VERSION = process.env.RENDERER_VERSION?.trim() || 'v1';
const DEFAULT_RENDERER_WATCHDOG_TIMEOUT_MS = 5 * 60_000;

const decodeInlineAsset = (
  asset?: RendererInlineAsset | null,
): { bytes: Uint8Array; contentType: string; objectKey: string } | null => {
  if (!asset?.base64) return null;
  const bytes = Buffer.from(asset.base64, 'base64');
  return {
    bytes: new Uint8Array(bytes),
    contentType: asset.contentType,
    objectKey: asset.objectKey ?? '',
  };
};

const normalizeRendererError = (error: unknown): { errorCode: RendererErrorCode; errorMessage: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNAUTHORIZED_RENDERER_CALL/i.test(message)) {
    return { errorCode: 'UNAUTHORIZED_RENDERER_CALL', errorMessage: 'Unauthorized renderer call' };
  }
  if (/TABLE_RENDER_STUCK/i.test(message)) {
    return { errorCode: 'TABLE_RENDER_STUCK', errorMessage: 'Table render stuck' };
  }
  if (/BACKGROUND_FETCH_FAILED/i.test(message) || /background/i.test(message)) {
    return { errorCode: 'BACKGROUND_FETCH_FAILED', errorMessage: 'Background fetch failed' };
  }
  if (/FONT_LOAD_FAILED/i.test(message) || /ENOENT/i.test(message) || /font/i.test(message)) {
    return { errorCode: 'FONT_LOAD_FAILED', errorMessage: 'Font load failed' };
  }
  if (/UPLOAD_FAILED/i.test(message) || /upload/i.test(message)) {
    return { errorCode: 'UPLOAD_FAILED', errorMessage: 'PDF upload failed' };
  }
  if (/RENDERER_TIMEOUT/i.test(message) || /timeout/i.test(message)) {
    return { errorCode: 'RENDERER_TIMEOUT', errorMessage: 'Renderer request timed out' };
  }
  if (/INVALID_PAYLOAD/i.test(message) || /request body too large/i.test(message)) {
    return { errorCode: 'INVALID_PAYLOAD', errorMessage: 'Invalid render payload' };
  }
  if (/TEMPLATE_LOAD_FAILED/i.test(message) || /template/i.test(message)) {
    return { errorCode: 'TEMPLATE_LOAD_FAILED', errorMessage: 'Template load failed' };
  }
  if (/RENDERER_HTTP_FAILED/i.test(message)) {
    return { errorCode: 'RENDERER_HTTP_FAILED', errorMessage: 'Worker internal HTTP failed' };
  }
  if (/JOB_NOT_FOUND/i.test(message)) {
    return { errorCode: 'JOB_NOT_FOUND', errorMessage: 'Render job not found' };
  }
  if (/FILE_NOT_READY/i.test(message)) {
    return { errorCode: 'FILE_NOT_READY', errorMessage: 'Render output file is not ready' };
  }
  return { errorCode: 'RENDER_FAILED', errorMessage: message };
};

const getRendererWatchdogTimeoutMs = (): number => {
  const parsed = Number(process.env.RENDERER_WATCHDOG_TIMEOUT_MS ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RENDERER_WATCHDOG_TIMEOUT_MS;
};

const getExecutionName = (): string | null =>
  process.env.CLOUD_RUN_EXECUTION?.trim() ||
  process.env.CLOUD_RUN_JOB?.trim() ||
  null;

const buildLogContext = (stored: StoredRenderJobPayload) => ({
  jobId: stored.jobId,
  templateId: stored.record.templateId || stored.renderRequest.meta.templateId,
  tenantId: stored.record.tenantId || stored.renderRequest.meta.tenantId,
  rendererVersion: RENDERER_VERSION,
  executionName: getExecutionName() ?? stored.record.executionName ?? null,
  backgroundKey: stored.renderRequest.assets.backgroundKey ?? null,
});

const createStageLogger = (logContext: ReturnType<typeof buildLogContext>) => {
  const logStageStart = (stage: string) => {
    logRendererInfo('always', '[DBG_RENDERER_STAGE_START]', {
      ...logContext,
      stage,
    });
  };

  const logStageDone = (stage: string, ms: number) => {
    logRendererInfo('always', '[DBG_RENDERER_STAGE_DONE]', {
      ...logContext,
      stage,
      ms,
    });
  };

  const logStageError = (stage: string, error: unknown) => {
    const normalized = normalizeRendererError(error);
    logRendererError('always', '[DBG_RENDERER_STAGE_ERROR]', {
      ...logContext,
      stage,
      errorCode: normalized.errorCode,
      message: normalized.errorMessage,
    });
  };

  const runStage = async <T>(stage: string, fn: () => Promise<T> | T): Promise<T> => {
    const startedAt =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    logStageStart(stage);
    try {
      const result = await fn();
      const endedAt =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      logStageDone(stage, Math.round(endedAt - startedAt));
      return result;
    } catch (error) {
      logStageError(stage, error);
      throw error;
    }
  };

  return { runStage };
};

export const runRenderJob = async (args: { jobId: string }) => {
  const requestId = `${args.jobId}:${Date.now()}`;
  const timeoutMs = resolveWorkerInternalTimeoutMs();
  const watchdogMs = getRendererWatchdogTimeoutMs();
  const startedAt = Date.now();
  const executionName = getExecutionName();

  console.error('[RUN_RENDER_JOB_FETCH_PAYLOAD_START]', JSON.stringify({
    jobId: args.jobId,
    requestId,
  }));
  const stored = await fetchRenderJobPayload({
    jobId: args.jobId,
    rendererVersion: RENDERER_VERSION,
    requestId,
  });
  console.error('[RUN_RENDER_JOB_FETCH_PAYLOAD_DONE]', JSON.stringify({
    jobId: args.jobId,
    requestId,
    status: stored.record.status,
    templateId: stored.record.templateId,
    tenantId: stored.record.tenantId,
  }));
  const payload = stored.renderRequest;
  const logContext = buildLogContext(stored);
  const { runStage } = createStageLogger(logContext);

  let backgroundBytes = 0;
  let pdfKey = payload.assets.pdfKey ?? `renders/${payload.jobId}/output.pdf`;
  let workerResultUpdated = false;
  let currentStage: string | null = null;
  let watchdogTimer: NodeJS.Timeout | null = null;
  let renderStartedAt = new Date().toISOString();

  logRendererInfo('always', '[DBG_RENDERER_REQUEST]', {
    ...logContext,
    renderEngine: 'cloud_run_job',
    status: stored.record.status,
  });
  logRendererInfo('always', '[DBG_RENDER_JOB_RUNNER_START]', {
    ...logContext,
    renderEngine: 'cloud_run_job',
    status: stored.record.status,
    timeoutMs,
    watchdogMs,
  });

  try {
    console.error('[RUN_RENDER_JOB_TRANSITION_START]', JSON.stringify({
      jobId: payload.jobId,
      requestId,
      to: 'running',
      executionName,
    }));
    const transition = await transitionRenderJob({
      jobId: payload.jobId,
      templateId: payload.meta.templateId,
      tenantId: payload.meta.tenantId,
      rendererVersion: RENDERER_VERSION,
      requestId,
      transition: {
        status: 'running',
        rendererVersion: RENDERER_VERSION,
        executionName,
        renderStartedAt,
        attempt: stored.record.attempt ?? 1,
      },
    });
    console.error('[RUN_RENDER_JOB_TRANSITION_DONE]', JSON.stringify({
      jobId: payload.jobId,
      requestId,
      transition,
    }));
    if (transition && transition.skip === true) {
      logRendererInfo('always', '[DBG_RENDER_SUMMARY]', {
        ...logContext,
        renderEngine: 'cloud_run_job',
        status: String(transition.status ?? stored.record.status),
        timeoutMs,
        renderMs: 0,
        pdfBytes: null,
        backgroundBytes: null,
        errorCode: null,
        renderStartedAt,
        renderFinishedAt: null,
        durationMs: 0,
        outputBytes: null,
        failureStage: null,
        skipped: true,
      });
      return { ok: true, jobId: payload.jobId, skipped: true };
    }

    const watchdog = new Promise<never>((_, reject) => {
      watchdogTimer = setTimeout(() => {
        reject(
          new Error(
            `RENDERER_TIMEOUT: renderer watchdog exceeded ${watchdogMs}ms` +
              (currentStage ? ` during ${currentStage}` : ''),
          ),
        );
      }, watchdogMs);
    });

    const pipeline = (async () => {
      const backgroundLoadStartedAt = Date.now();
      console.error('[RUN_RENDER_JOB_BACKGROUND_START]', JSON.stringify({
        jobId: payload.jobId,
        requestId,
        backgroundKey: payload.assets.backgroundKey ?? null,
      }));
      const background = payload.assets.backgroundKey
        ? await fetchAssetBytes(payload.assets.backgroundKey, requestId, {
            jobId: payload.jobId,
            templateId: payload.meta.templateId,
            tenantId: payload.meta.tenantId,
            rendererVersion: RENDERER_VERSION,
            backgroundKey: payload.assets.backgroundKey ?? null,
          })
        : null;
      backgroundBytes = background?.bytes.length ?? 0;
      console.error('[RUN_RENDER_JOB_BACKGROUND_DONE]', JSON.stringify({
        jobId: payload.jobId,
        requestId,
        backgroundBytes,
      }));
      logRendererInfo('always', '[DBG_RENDERER_BACKGROUND_FETCH_DONE]', {
        ...logContext,
        backgroundBytes,
        pdfBytes: null,
        renderMs: null,
        loadMs: Date.now() - backgroundLoadStartedAt,
        errorCode: null,
      });

      const fontLoadStartedAt = Date.now();
      console.error('[RUN_RENDER_JOB_FONT_START]', JSON.stringify({
        jobId: payload.jobId,
        requestId,
        jpFontFamily: payload.meta.jpFontFamily ?? null,
      }));
      const fonts = await getFonts(payload.meta.jpFontFamily);
      console.error('[RUN_RENDER_JOB_FONT_DONE]', JSON.stringify({
        jobId: payload.jobId,
        requestId,
        requestedFamily: fonts.requestedFamily,
        resolvedFamily: fonts.resolvedFamily,
        latinBytes: fonts.latin.length,
        jpBytes: fonts.jp.length,
      }));
      logRendererInfo('always', '[DBG_RENDERER_FONT_LOAD_DONE]', {
        ...logContext,
        backgroundBytes,
        pdfBytes: null,
        renderMs: null,
        requestedFamily: fonts.requestedFamily,
        resolvedFamily: fonts.resolvedFamily,
        fellBackToNoto: fonts.fellBackToNoto,
        latinBytes: fonts.latin.length,
        jpBytes: fonts.jp.length,
        loadMs: Date.now() - fontLoadStartedAt,
        jpSubset: false,
        latinSubset: true,
        errorCode: null,
      });

      const tenantLogo = decodeInlineAsset(payload.assets.tenantLogo);
      const rendered = await renderTemplateToPdf(
        payload.template,
        payload.data,
        {
          jp: payload.options.useJpFont ? fonts.jp : null,
          latin: fonts.latin,
        },
        {
          debug: false,
          previewMode: payload.options.previewMode,
          renderMode: payload.options.renderMode,
          useJpFont: payload.options.useJpFont,
          superFastMode: payload.options.superFastMode,
          layer: background ? 'dynamic' : 'full',
          backgroundPdfBytes: background?.bytes ?? undefined,
          tenantLogo: tenantLogo ?? undefined,
          skipLogo: payload.options.skipLogo,
          skipStaticLabels: payload.options.skipStaticLabels,
          useBaseBackgroundDoc: payload.options.useBaseBackgroundDoc,
          requestId,
          onLayoutResolved: (details) => {
            console.error('[RUN_RENDER_JOB_LAYOUT_RESOLVED]', JSON.stringify({
              ...logContext,
              pageHeight: details.pageHeight,
              templateYMode: details.templateYMode,
              tableId: details.tableId,
              presetId: details.presetId,
              incomingTableY: details.incomingTableY,
              normalizedTableY: details.normalizedTableY,
              pdfTableStartY: details.pdfTableStartY,
              bodyStartY: details.bodyStartY,
            }));
            logRendererInfo('always', '[DBG_RENDERER_LAYOUT_RESOLVED]', {
              ...logContext,
              pageHeight: details.pageHeight,
              templateYMode: details.templateYMode,
              tableId: details.tableId,
              presetId: details.presetId,
              incomingTableY: details.incomingTableY,
              normalizedTableY: details.normalizedTableY,
              pdfTableStartY: details.pdfTableStartY,
              bodyStartY: details.bodyStartY,
            });
          },
          onTableStart: (details) => {
            console.error('[RUN_RENDER_JOB_TABLE_START]', JSON.stringify({
              ...logContext,
              templateYMode: details.templateYMode,
              incomingTableY: details.incomingTableY,
              normalizedTableY: details.normalizedTableY,
              rowsTotal: details.rowsTotal,
              pageIndex: details.pageIndex,
              currentY: details.currentY,
              pageHeight: details.pageHeight,
              usableTop: details.usableTop,
              usableBottom: details.usableBottom,
              availableHeight: details.availableHeight,
              reservedFooterHeight: details.reservedFooterHeight,
              explicitFooterReserveHeight: details.explicitFooterReserveHeight,
              derivedFooterBoundary: details.derivedFooterBoundary,
              headerHeight: details.headerHeight,
              tableHeaderHeight: details.tableHeaderHeight,
              firstRowHeight: details.firstRowHeight,
              rowBottomY: details.rowBottomY,
              nextY: details.nextY,
              pageBreakThreshold: details.pageBreakThreshold,
              tableStartY: details.tableStartY,
              bodyStartY: details.bodyStartY,
              clampApplied: details.clampApplied,
              clampReason: details.clampReason ?? null,
            }));
            logRendererInfo('debug', '[DBG_RENDERER_TABLE_START]', {
              ...logContext,
              templateYMode: details.templateYMode,
              incomingTableY: details.incomingTableY,
              normalizedTableY: details.normalizedTableY,
              rowsTotal: details.rowsTotal,
              pageIndex: details.pageIndex,
              currentY: details.currentY,
              pageHeight: details.pageHeight,
              usableTop: details.usableTop,
              usableBottom: details.usableBottom,
              availableHeight: details.availableHeight,
              reservedFooterHeight: details.reservedFooterHeight,
              explicitFooterReserveHeight: details.explicitFooterReserveHeight,
              derivedFooterBoundary: details.derivedFooterBoundary,
              headerHeight: details.headerHeight,
              tableHeaderHeight: details.tableHeaderHeight,
              firstRowHeight: details.firstRowHeight,
              rowBottomY: details.rowBottomY,
              nextY: details.nextY,
              pageBreakThreshold: details.pageBreakThreshold,
              tableStartY: details.tableStartY,
              bodyStartY: details.bodyStartY,
              clampApplied: details.clampApplied,
              clampReason: details.clampReason ?? null,
            });
          },
          onTableRow: (details) => {
            logRendererInfo('debug', '[DBG_RENDERER_TABLE_ROW]', {
              ...logContext,
              rowIndex: details.rowIndex,
              pageIndex: details.pageIndex,
              currentY: details.currentY,
              remainingRows: details.remainingRows,
              availableHeight: details.availableHeight,
              firstRowHeight: details.firstRowHeight,
              rowBottomY: details.rowBottomY,
              nextY: details.nextY,
              usableBottom: details.usableBottom,
            });
          },
          onTablePageBreak: (details) => {
            logRendererInfo('debug', '[DBG_RENDERER_TABLE_PAGE_BREAK]', {
              ...logContext,
              rowIndex: details.rowIndex,
              pageIndex: details.pageIndex,
              currentY: details.currentY,
              remainingRows: details.remainingRows,
              availableHeight: details.availableHeight,
              firstRowHeight: details.firstRowHeight,
              rowBottomY: details.rowBottomY,
              nextY: details.nextY,
              usableBottom: details.usableBottom,
            });
          },
          onTableDone: (details) => {
            logRendererInfo('debug', '[DBG_RENDERER_TABLE_DONE]', {
              ...logContext,
              rowsDrawn: details.rowsDrawn,
              pagesUsed: details.pagesUsed,
              ms: details.ms,
            });
          },
          onTableError: (details) => {
            console.error('[RUN_RENDER_JOB_TABLE_ERROR]', JSON.stringify({
              ...logContext,
              templateYMode: details.templateYMode,
              incomingTableY: details.incomingTableY,
              normalizedTableY: details.normalizedTableY,
              rowIndex: details.rowIndex,
              pageIndex: details.pageIndex,
              currentY: details.currentY,
              remainingRows: details.remainingRows,
              pageHeight: details.pageHeight,
              usableTop: details.usableTop,
              usableBottom: details.usableBottom,
              availableHeight: details.availableHeight,
              reservedFooterHeight: details.reservedFooterHeight,
              explicitFooterReserveHeight: details.explicitFooterReserveHeight,
              derivedFooterBoundary: details.derivedFooterBoundary,
              headerHeight: details.headerHeight,
              tableHeaderHeight: details.tableHeaderHeight,
              firstRowHeight: details.firstRowHeight,
              rowBottomY: details.rowBottomY,
              nextY: details.nextY,
              pageBreakThreshold: details.pageBreakThreshold,
              tableStartY: details.tableStartY,
              bodyStartY: details.bodyStartY,
              clampApplied: details.clampApplied,
              clampReason: details.clampReason ?? null,
              reason: details.reason,
              errorMessage: details.message,
            }));
            logRendererError('always', '[DBG_RENDERER_TABLE_ERROR]', {
              ...logContext,
              templateYMode: details.templateYMode,
              incomingTableY: details.incomingTableY,
              normalizedTableY: details.normalizedTableY,
              rowIndex: details.rowIndex,
              pageIndex: details.pageIndex,
              currentY: details.currentY,
              remainingRows: details.remainingRows,
              pageHeight: details.pageHeight,
              usableTop: details.usableTop,
              usableBottom: details.usableBottom,
              availableHeight: details.availableHeight,
              reservedFooterHeight: details.reservedFooterHeight,
              explicitFooterReserveHeight: details.explicitFooterReserveHeight,
              derivedFooterBoundary: details.derivedFooterBoundary,
              headerHeight: details.headerHeight,
              tableHeaderHeight: details.tableHeaderHeight,
              firstRowHeight: details.firstRowHeight,
              rowBottomY: details.rowBottomY,
              nextY: details.nextY,
              pageBreakThreshold: details.pageBreakThreshold,
              tableStartY: details.tableStartY,
              bodyStartY: details.bodyStartY,
              clampApplied: details.clampApplied,
              clampReason: details.clampReason ?? null,
              reason: details.reason,
              errorCode: 'TABLE_RENDER_STUCK',
              message: details.message,
            });
          },
          onStageStart: (stage: RenderPipelineStage) => {
            if (stage === 'upload_pdf' || stage === 'result_update') return;
            currentStage = stage;
            console.error('[RUN_RENDER_JOB_STAGE_START]', JSON.stringify({
              jobId: payload.jobId,
              requestId,
              stage,
            }));
            logRendererInfo('always', '[DBG_RENDERER_STAGE_START]', {
              ...logContext,
              stage,
            });
          },
          onStageDone: (stage: RenderPipelineStage, ms: number) => {
            if (stage === 'upload_pdf' || stage === 'result_update') return;
            console.error('[RUN_RENDER_JOB_STAGE_DONE]', JSON.stringify({
              jobId: payload.jobId,
              requestId,
              stage,
              ms,
            }));
            logRendererInfo('always', '[DBG_RENDERER_STAGE_DONE]', {
              ...logContext,
              stage,
              ms,
            });
            currentStage = null;
          },
          onStageError: (stage: RenderPipelineStage, error: unknown) => {
            if (stage === 'upload_pdf' || stage === 'result_update') return;
            const normalized = normalizeRendererError(error);
            console.error('[RUN_RENDER_JOB_STAGE_ERROR]', JSON.stringify({
              jobId: payload.jobId,
              requestId,
              stage,
              errorCode: normalized.errorCode,
              errorMessage: normalized.errorMessage,
            }));
            logRendererError('always', '[DBG_RENDERER_STAGE_ERROR]', {
              ...logContext,
              stage,
              errorCode: normalized.errorCode,
              message: normalized.errorMessage,
            });
            currentStage = stage;
          },
        },
      );
      return { rendered };
    })();

    const { rendered } = await Promise.race([pipeline, watchdog]);
    const pdfBytes = rendered.bytes;
    const renderMs = Date.now() - startedAt;
    const renderFinishedAt = new Date().toISOString();
    logRendererInfo('always', '[DBG_RENDERER_RENDER_DONE]', {
      ...logContext,
      renderMs,
      pdfBytes: pdfBytes.length,
      backgroundBytes,
      errorCode: null,
    });

    currentStage = 'upload_pdf';
    console.error('[RUN_RENDER_JOB_STAGE_START]', JSON.stringify({
      jobId: payload.jobId,
      requestId,
      stage: 'upload_pdf',
    }));
    await runStage('upload_pdf', () =>
      uploadRenderedPdf({
        jobId: payload.jobId,
        templateId: payload.meta.templateId,
        tenantId: payload.meta.tenantId,
        pdfKey,
        pdfBytes,
        rendererVersion: RENDERER_VERSION,
        requestId,
      }),
    );
    currentStage = null;
    logRendererInfo('always', '[DBG_RENDERER_UPLOAD_DONE]', {
      ...logContext,
      backgroundBytes,
      pdfKey,
      pdfBytes: pdfBytes.length,
      renderMs,
      errorCode: null,
    });

    const doneResult: RendererJobResultRequest = {
      status: 'done',
      pdfKey,
      pdfBytes: pdfBytes.length,
      backgroundBytes,
      renderMs,
      rendererVersion: RENDERER_VERSION,
      executionName,
      renderStartedAt,
      renderFinishedAt,
    };
    currentStage = 'result_update';
    console.error('[RUN_RENDER_JOB_STAGE_START]', JSON.stringify({
      jobId: payload.jobId,
      requestId,
      stage: 'result_update',
      status: 'done',
    }));
    await runStage('result_update', async () => {
      await updateRenderJobResult({
        jobId: payload.jobId,
        templateId: payload.meta.templateId,
        tenantId: payload.meta.tenantId,
        rendererVersion: RENDERER_VERSION,
        requestId,
        result: doneResult,
      });
      workerResultUpdated = true;
    });
    currentStage = null;
    logRendererInfo('always', '[DBG_RENDERER_RESULT_UPDATE]', {
      ...logContext,
      status: 'done',
      pdfKey,
      pdfBytes: pdfBytes.length,
      backgroundBytes,
      renderMs,
      errorCode: null,
    });
    logRendererInfo('always', '[DBG_RENDER_SUMMARY]', {
      ...logContext,
      renderEngine: 'cloud_run_job',
      status: 'done',
      timeoutMs,
      renderMs,
      pdfKey,
      pdfBytes: pdfBytes.length,
      backgroundBytes,
      errorCode: null,
      renderStartedAt,
      renderFinishedAt,
      durationMs: renderMs,
      outputBytes: pdfBytes.length,
      failureStage: null,
    });
    return { ok: true, jobId: payload.jobId, pdfKey, pdfBytes: pdfBytes.length, renderMs };
  } catch (error) {
    const normalized = normalizeRendererError(error);
    const renderMs = Date.now() - startedAt;
    const renderFinishedAt = new Date().toISOString();
    console.error('[RUN_RENDER_JOB_CATCH]', JSON.stringify({
      jobId: args.jobId,
      requestId,
      currentStage,
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }));
    logRendererError('always', '[DBG_RENDERER_ERROR]', {
      ...logContext,
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      backgroundBytes,
      pdfBytes: null,
      renderMs,
      failureStage: currentStage,
    });

    if (!workerResultUpdated) {
      try {
        const failedResult: RendererJobResultRequest = {
          status: 'failed',
          errorCode: normalized.errorCode,
          errorMessage: normalized.errorMessage,
          backgroundBytes,
          renderMs,
          rendererVersion: RENDERER_VERSION,
          executionName,
          renderStartedAt,
          renderFinishedAt,
          failureStage: currentStage,
          errorSummary: normalized.errorMessage,
          errorDetails: error instanceof Error ? error.stack ?? error.message : String(error),
        };
        currentStage = 'result_update';
        console.error('[RUN_RENDER_JOB_STAGE_START]', JSON.stringify({
          jobId: payload.jobId,
          requestId,
          stage: 'result_update',
          status: 'failed',
        }));
        await runStage('result_update', async () => {
          await updateRenderJobResult({
            jobId: payload.jobId,
            templateId: payload.meta.templateId,
            tenantId: payload.meta.tenantId,
            rendererVersion: RENDERER_VERSION,
            requestId,
            result: failedResult,
          });
          workerResultUpdated = true;
        });
        currentStage = null;
        logRendererInfo('always', '[DBG_RENDERER_RESULT_UPDATE]', {
          ...logContext,
          status: 'failed',
          pdfKey,
          pdfBytes: null,
          backgroundBytes,
          renderMs,
          errorCode: normalized.errorCode,
        });
      } catch (resultError) {
        const resultUpdateError = normalizeRendererError(resultError);
        logRendererError('always', '[DBG_RENDERER_ERROR]', {
          ...logContext,
          errorCode: resultUpdateError.errorCode,
          errorMessage: resultUpdateError.errorMessage,
          backgroundBytes,
          pdfBytes: null,
          renderMs,
          stage: 'result_update',
        });
      }
    }

    logRendererInfo('always', '[DBG_RENDER_SUMMARY]', {
      ...logContext,
      renderEngine: 'cloud_run_job',
      status: 'failed',
      timeoutMs,
      renderMs,
      pdfBytes: null,
      backgroundBytes,
      errorCode: normalized.errorCode,
      renderStartedAt,
      renderFinishedAt,
      durationMs: renderMs,
      outputBytes: null,
      failureStage: currentStage,
    });
    throw error;
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer);
  }
};
