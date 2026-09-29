FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npx prettier --write src/dashboardTheme.css
RUN cat src/dashboardTheme.css && exit 1

CMD ["node", "-e", "setInterval(() => {}, 2147483647)"]
