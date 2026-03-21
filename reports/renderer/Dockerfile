FROM node:20-alpine AS build
WORKDIR /app

COPY renderer/package.json ./renderer/package.json
RUN cd renderer && npm install

COPY shared ./shared
COPY worker/src/pdf ./worker/src/pdf
COPY renderer ./renderer

RUN cd renderer && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/renderer
ENV NODE_ENV=production

COPY --from=build /app/renderer/package.json ./package.json
COPY --from=build /app/renderer/node_modules ./node_modules
COPY --from=build /app/renderer/dist ./dist
COPY --from=build /app/renderer/assets ./assets

CMD ["node", "dist/renderer/src/server.js"]
