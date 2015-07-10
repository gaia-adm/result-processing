FROM gaiaadm/nodejs:0.12.6

ENV http_proxy 'http://proxy.bbn.hp.com:8080'
ENV https_proxy 'http://proxy.bbn.hp.com:8080'

RUN npm install -g nodemon

# Set the working directory
WORKDIR   /src

CMD ["/bin/bash"]
