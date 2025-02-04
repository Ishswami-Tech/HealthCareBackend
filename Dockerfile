# Development
FROM node:20-alpine AS development

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

# Create public directory if it doesn't exist
RUN mkdir -p public

RUN npm run build

# Production
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --only=production

COPY . .
RUN mkdir -p public

COPY --from=development /usr/src/app/dist ./dist

CMD ["node", "dist/main"] 