FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .npmrc ./
RUN npm install
COPY . .
ARG VITE_EVENT_WEBSITES_ENABLED=true
ENV VITE_EVENT_WEBSITES_ENABLED=$VITE_EVENT_WEBSITES_ENABLED

RUN npm run build

FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
