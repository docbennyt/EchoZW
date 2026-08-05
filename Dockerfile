FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 80
CMD ["node", "dist-server/server/productionServer.js"]
