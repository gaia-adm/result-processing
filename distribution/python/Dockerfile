FROM gaiaadm/nodejs-python:3.5.1

# Set the working directory
WORKDIR /src

# Bundle app source
COPY . /src

RUN npm install

CMD ["node", "/src/server.js"]
