declare module 'qrcode-generator' {
  type QrCode = {
    addData: (data: string) => void;
    make: () => void;
    getModuleCount: () => number;
    isDark: (row: number, col: number) => boolean;
  };

  export default function qrcode(
    typeNumber: number,
    errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H',
  ): QrCode;
}
