FROM public.ecr.aws/docker/library/node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]
