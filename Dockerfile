FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build

EXPOSE 80
CMD ["npm", "run", "preview", "--", "--port", "80"]
