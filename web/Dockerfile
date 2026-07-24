FROM node:20-alpine

WORKDIR /app

# Install dependencies (cached unless package files change)
COPY package.json package-lock.json ./
RUN npm install

# App source
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
