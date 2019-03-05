FROM node:10 as intermediate

# First add just the package json file and do in-container install
# This way, we only rebuild deps if package.json is changed
RUN mkdir -p /tmp/app

ADD package.json /tmp/app/
ADD yarn.lock /tmp/app/
RUN cd /tmp/app && yarn install

ADD . /tmp/app/
RUN cd /tmp/app && yarn pack --production --unsafe-perm -f app.tgz
RUN cd /tmp/app && tar xzf app.tgz -C /tmp
RUN cd /tmp/package && yarn install --production

FROM node:10
RUN ln -fs /usr/share/zoneinfo/Europe/Stockholm /etc/localtime && dpkg-reconfigure --frontend noninteractive tzdata

ENV NODE_ENV=production
ENV NODE_HEAPDUMP_OPTIONS=nosignal
RUN mkdir -p /app/logs
# First add just the package json file and do in-container install
# This way, we only rebuild deps if package.json is changed
COPY --chown=node:node --from=intermediate /tmp/package /app

USER node
WORKDIR /app
EXPOSE 3000
CMD ["node", "."]
