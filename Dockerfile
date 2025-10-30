# -----------------------
# Base image
# -----------------------
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# -----------------------
# Development image
# -----------------------
FROM base AS development
RUN npm install -g nodemon wait-on
ENV NODE_ENV=development
EXPOSE 3001
CMD ["npm", "run", "dev"]

# -----------------------
# Production image
# -----------------------
FROM base AS production
RUN npm install -g pm2
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npm", "run", "start"]
