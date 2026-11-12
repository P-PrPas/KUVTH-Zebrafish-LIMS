# Deploying a service

## Setup Docker


1. Docker is pre-installed to the VM, which you can run any docker command to test daemon is working.

   ```yaml
   docker ps
   ```
2. Docker is not autostart by default, to make it autostart, use the following command:

   ```yaml
   systemctl enable --now docker.service
   ```
3. Then create a Docker network subnet of `172.20.0.0/16` named `bridge0` for networking across containers.

   ```yaml
   docker network create --driver=bridge --subnet=172.20.0.0/16 bridge0
   ```

## Directory Structure

The service container should follow pre-defined directory structure to make it easier to manage as following tree

```none
/root
├── core
│   ├── docker-compose.yml (cr-nginx, 10.20.10.1, cr-watchtower, 10.20.10.2)
│   └── config/
├── service
│   ├── postgres
│   │   ├── docker-compose.yml (sv-postgres, 172.20.20.10)
│   │   └── data/
│   └── clickhouse
│       ├── docker-compose.yml (sv-clickhouse, 172.20.20.11)
│       └── data/
└── app
    ├── flow
    │   └── docker-compose.yml (ap-flow, 172.20.30.1, ap-flow-extra, 10.20.30.2)
    └── foo
        └── docker-compose.yml (ap-foo, 172.20.31.1, ap-foo-extra, 10.20.31.2)
```

### `~/core`

The main container that shared or used across the containers.

* Example `~/core/docker-compose.yml`

  ```yaml
  services:
    nginx:
      image: nginx:stable
      container_name: cr-nginx
      hostname: cr-nginx
      networks:
        bridge0:
          ipv4_address: 172.20.10.1
      volumes:
        - type: bind
          source: ./config
          target: /etc/nginx/conf.d
          read_only: true
        - type: bind
          source: ./resource
          target: /etc/nginx/resource
          read_only: true
        - type: bind
          source: ./log
          target: /etc/nginx/log
      mem_limit: 1G
      memswap_limit: 1G
      restart: unless-stopped
      logging:
        driver: none
   
    watchtower:
      image: nickfedor/watchtower:1
      container_name: cr-watchtower
      hostname: cr-watchtower
      networks:
        bridge0:
          ipv4_address: 172.20.10.2
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
        - /root/.docker/config.json:/config.json
      command: --schedule "*/1 * * * *" --cleanup --label-enable
      cpus: 0.5
      mem_limit: 256M
      memswap_limit: 256M
      restart: unless-stopped
      logging:
        driver: none
  
  networks:
    bridge0:
      name: bridge0
      external: true
  ```
* Example `~/core/config/0.conf`

  ```none
  map $host $target_upstream {
    hostnames;
    example.connectedtech.dev             127.0.0.1:80;
  }
  
  map $http_upgrade $connection_upgrade {
    default                               upgrade;
    ''                                    close;
  }
  
  server {
    listen 80 default;
    http2 on;
    resolver                              10.1. valid=300s;
    resolver_timeout                      1s;
  
    client_max_body_size 0;
  
    root /usr/share/nginx/html;
    access_log /etc/nginx/log/$host-access.log combined;
  
    location / {
      proxy_pass http://$target_upstream;
      proxy_http_version  1.1;
      proxy_set_header Host               $host;
      proxy_set_header Upgrade            $http_upgrade;
      proxy_set_header Connection         $connection_upgrade;
      proxy_set_header X-Real-IP          $remote_addr;
      proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto  $scheme;
      proxy_set_header X-Forwarded-Host   $host;
      proxy_set_header X-Forwarded-Port   $server_port;
      proxy_set_header X-Original-URI     $request_uri;
      proxy_pass_request_headers on;
      proxy_hide_header X-Powered-By;
      proxy_hide_header Server;
      proxy_redirect off;
      proxy_connect_timeout 1s;
      proxy_buffering off;
      proxy_cache off;
    }
  }
  ```

`~/service`

The shared service across many apps

* Example `~/service/postgres/docker-compose.yml`

  ```yaml
  services:
    postgres:
      image: postgres:18
      container_name: sv-postgres
      hostname: sv-postgres
      networks:
        bridge0:
          ipv4_address: 172.20.20.10
      volumes:
        - ./postgres:/var/lib/postgresql
      environment:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: …
        POSTGRES_DB: …
        TZ: Asia/Bangkok
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U postgres -d orbit"]
        start_period: 10s
        interval: 1m
        timeout: 5s
        retries: 5
      cpus: 1.0
      mem_limit: 1G
      memswap_limit: 1G
      restart: unless-stopped
      logging:
        driver: none
  ```

Note that some service might be placed with the app instead as well, if the service is run specifically to the app.

`~/app`

Each application to deploy, packed as the container

* Example `~/app/foo/docker-compose.yml`

  ```yaml
  services:
    orbit:
      image: container.connectedtech.dev/foo:v1
      container_name: ap-foo
      hostname: ap-foo
      networks:
        bridge0:
          ipv4_address: 172.20.30.10
      ports:
        - 8090:8081
      environment:
        ADDR: :8081
        DATABASE_URL: postgresql://postgres:…@sv-postgres:5432/orbit?sslmode=disable
        JWT_SECRET: …
        TZ: Asia/Bangkok
      volumes:
        - ./data:/opt/foo/data
      healthcheck:
        test: ["CMD", "wget", "-qO-", "http://localhost:8081/health"]
        start_period: 30s
        interval: 1m
        timeout: 5s
        retries: 5
      depends_on:
        postgres:
          condition: service_healthy
      labels:
        - "com.centurylinklabs.watchtower.enable=true"
      cpus: 1.0
      mem_limit: 1G
      memswap_limit: 1G
      restart: unless-stopped
      logging:
        driver: none
  
    postgres:
      image: postgres:18
      container_name: ap-foo-postgres
      hostname: ap-foo-postgres
      networks:
        bridge0:
          ipv4_address: 172.20.30.11
      volumes:
        - ./postgres:/var/lib/postgresql
      environment:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: …
        POSTGRES_DB: foo1
        TZ: Asia/Bangkok
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U postgres -d orbit"]
        start_period: 10s
        interval: 1m
        timeout: 5s
        retries: 5
      cpus: 1.0
      mem_limit: 1G
      memswap_limit: 1G
      restart: unless-stopped
      logging:
        driver: none
  
  networks:
    bridge0:
      name: bridge0
      external: true
  ```


:::info
Learn more on Docker Compose templates on [Docker Compose Template](/doc/b70643e5-d8d7-48cb-8f97-a78203668527)

:::