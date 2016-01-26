FROM gaiaadm/nodejs:0.12.6

ARG https_proxy=""
ARG http_proxy=""

RUN apt-get update && \
    apt-get install -y netcat && \
    apt-get clean

# Set the working directory
WORKDIR /src

# Bundle app source
COPY . /src

RUN npm install

CMD ["node", "/src/server.js"]
