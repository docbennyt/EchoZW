FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN NODE_ENV=test APP_ENV=test npm test
RUN npm run lint
RUN npm run format:check
RUN npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]
