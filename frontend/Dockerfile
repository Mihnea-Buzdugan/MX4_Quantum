FROM node:22

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

ENV HOST=0.0.0.0
ENV CHOKIDAR_USEPOLLING=true
ENV WATCHPACK_POLLING=true

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]