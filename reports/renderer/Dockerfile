FROM node:20-alpine AS build
WORKDIR /app/renderer

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY assets ./assets

RUN npm ci
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/renderer
ENV NODE_ENV=production

COPY --from=build /app/renderer/package.json ./package.json
COPY --from=build /app/renderer/package-lock.json ./package-lock.json
COPY --from=build /app/renderer/node_modules ./node_modules
COPY --from=build /app/renderer/dist ./dist
COPY --from=build /app/renderer/assets ./assets

ENTRYPOINT ["node"]
CMD ["dist/src/server.js"]
