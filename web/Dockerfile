FROM nginx

# Ubuntu系であるためapt-getを使用
RUN apt-get update && \
    apt-get install -y vim && \
    apt install sudo && \
    sudo mkdir /etc/nginx/ssl
# 秘密鍵生成（rsa方式、2048bit）（SSL証明書発行用）
# https://vogel.at.webry.info/201503/article_9.html
RUN sudo apt install openssl && \
    touch /etc/nginx/ssl/server.key && \
    sudo openssl genrsa -out /etc/nginx/ssl/server.key 2048 && \
    chmod 400 /etc/nginx/ssl/server.key
# 証明書署名要求の発行
RUN sudo openssl req -new -key /etc/nginx/ssl/server.key -out /etc/nginx/ssl/server.csr -subj "/C=JP/ST=Tokyo/L=Toshima/O=MyOrg/OU=MyOrg/CN=baseball-game.example.com"
# 証明書の発行（x509→オレオレ）
RUN sudo openssl x509 -days 365 -req -signkey /etc/nginx/ssl/server.key -in /etc/nginx/ssl/server.csr -out /etc/nginx/ssl/server.crt

CMD ["nginx", "-g", "daemon off;", "-c", "/etc/nginx/nginx.conf"]
