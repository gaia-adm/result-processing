FROM gaiaadm/nodejs-python:3.4.0

ARG https_proxy=""
ARG http_proxy=""

# Set the working directory
WORKDIR /src

# Bundle app source
COPY . /src

RUN npm install

CMD ["node", "/src/server.js"]
