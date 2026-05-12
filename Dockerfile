FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

ENV NODE_ENV=production
EXPOSE 4173

CMD ["npm", "start"]
