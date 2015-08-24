FROM gaiaadm/nodejs-python:3.4.0

# Set the working directory
WORKDIR   /src

CMD ["node", "/src/server.js"]

# Bundle app source
COPY . /src

# setup.sh script is temporary workaround until Docker adds support for passing ENV variables
# to docker build command to allow setting up proxy
ADD setup.sh /tmp/setup.sh
RUN chmod +x /tmp/setup.sh \
    && /tmp/setup.sh /src
