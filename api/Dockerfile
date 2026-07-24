FROM node:20-alpine

WORKDIR /app

# Install dependencies (cached unless package files change)
COPY package.json package-lock.json ./
RUN npm install

# Prisma client needs the schema at generate time
COPY prisma ./prisma
RUN npx prisma generate

# App source
COPY . .

EXPOSE 3100

# entrypoint applies migrations + seeds, then starts the API in watch mode
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && npm run start:dev"]
