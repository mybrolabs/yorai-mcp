FROM node:22-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV HOST=0.0.0.0 PORT=3333
EXPOSE 3333
CMD ["node", "dist/http.js"]
