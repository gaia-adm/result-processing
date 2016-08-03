FROM gaiaadm/nodejs:4.4.7

RUN apk add --no-cache --virtual \
    racktables \
  && rm -rf /var/cache/apk/*

# Set the working directory
WORKDIR /src

# Bundle app source
COPY . /src

RUN npm install

CMD ["node", "/src/server.js"]
