FROM nginx

# nginxの公式イメージはDebian系のため、apt-getを使う。ビルド中は確認に答えられないため、-yを付ける
RUN apt-get update && \
    apt-get install -y --no-install-recommends vim openssl && \
    mkdir /etc/nginx/ssl
# 秘密鍵生成（rsa方式、2048bit）（SSL証明書発行用）
RUN touch /etc/nginx/ssl/server.key && \
    openssl genrsa -out /etc/nginx/ssl/server.key 2048 && \
    chmod 400 /etc/nginx/ssl/server.key
# 証明書署名要求の発行
RUN openssl req -new -key /etc/nginx/ssl/server.key -out /etc/nginx/ssl/server.csr -subj "/C=JP/ST=Tokyo/L=Toshima/O=MyOrg/OU=MyOrg/CN=baseball-game.example.com"
# 自己署名証明書の発行
RUN openssl x509 -days 365 -req -signkey /etc/nginx/ssl/server.key -in /etc/nginx/ssl/server.csr -out /etc/nginx/ssl/server.crt

CMD ["nginx", "-g", "daemon off;", "-c", "/etc/nginx/nginx.conf"]
