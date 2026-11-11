# AWS ECR & ECS

> Practical project: deploy a Dockerized Vite frontend + Express backend to AWS, expose it securely through an Application Load Balancer, enable HTTPS, and connect a custom domain using DNS.

This guide follows the concepts in the Sheryians ECS deployment notes and the supplied project architecture/Dockerfile. Where the guide expands beyond those materials (especially production networking, HTTPS and DNS), it is labelled as a practical deployment explanation.

---

## 1. What we are building

The project has a Vite frontend and an Express backend. The frontend is built into static files. The backend serves those files and exposes API endpoints.

### Local project structure

```text
project/
├── frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── public/             # Vite build is copied here in Docker
│   ├── server.js
│   └── package.json
├── Dockerfile
└── .dockerignore
```

### Local development

During development, Vite and Express can run as separate processes:

```text
Browser
  ├── Vite frontend :5173
  └── Express API   :3000
```

If the frontend calls the backend during development, configure the Vite development proxy or an appropriate API base URL. Do not hard-code `localhost` as the production API host if the browser will access the API through the same public domain.

### Production architecture

The supplied Dockerfile uses a multi-stage build to produce **one final image** containing the frontend build and backend server.

```text
User / Browser
      |
      | HTTPS :443
      v
Route 53 DNS
      |
      v
Application Load Balancer (public subnets)
      |
      | HTTP :3000 inside the VPC
      v
Target Group (health checks)
      |
      v
ECS Service
      |
      v
Fargate Task / Container
      ├── Express server :3000
      ├── React/Vite static build in /app/public
      └── API routes
```

Supporting services:

```text
Developer machine
    |
    | docker build / tag / push
    v
Amazon ECR (stores image)
    |
    | ECS pulls image using execution role
    v
Amazon ECS (runs and maintains tasks)

ECS container logs ---> CloudWatch Logs

ACM certificate ---> attached to ALB HTTPS listener
Route 53 DNS ------> points domain to ALB
```

## 2. Understand the services

### Docker

Docker packages the application and its runtime dependencies into an image. A running instance of an image is a container.

### ECR: Elastic Container Registry

ECR is AWS's managed container image registry.

- Stores Docker/OCI images.
- Provides private repositories.
- ECS can pull images from ECR.
- Image tags identify versions, for example `v1`, `v2` or a Git commit SHA.

**Remember:** ECR stores the image. It does not run the application.

### ECS: Elastic Container Service

ECS is AWS's container orchestration service. It manages the deployment and lifecycle of containers.

Key concepts:

| ECS concept | Meaning |
|---|---|
| Cluster | Logical grouping for ECS services and tasks |
| Task definition | Blueprint describing how a task runs |
| Task | Running instance of a task definition |
| Service | Keeps the desired number of tasks running and can integrate with a load balancer |
| Container | The application process running inside a task |

**Remember:** ECS runs and manages the containers. ECR stores the images those containers use.

### Fargate vs EC2 launch type

- **Fargate:** serverless compute for containers. AWS manages the underlying server infrastructure.
- **EC2 launch type:** you manage the EC2 instances that provide capacity to ECS.

For this beginner deployment, use **ECS with Fargate** so you can focus on the application and its deployment rather than managing EC2 hosts.

### Application Load Balancer (ALB)

An ALB distributes HTTP/HTTPS requests to healthy targets.

It operates at Layer 7 and supports host-based and path-based routing.

For this project, the ALB receives public web traffic and forwards requests to the ECS service's target group.

### Target Group

A target group contains the targets to which a load balancer forwards traffic.

For an ECS Fargate service using `awsvpc` networking, use target type **IP**. ECS registers and deregisters task IP addresses as tasks are replaced or scaled.

A target group's health check helps the load balancer decide whether a task is healthy enough to receive traffic.

### IAM roles used by ECS

Do not confuse these two roles:

| Role | Used by | Example |
|---|---|---|
| Task execution role | ECS/Fargate agent | Pull image from ECR, send logs to CloudWatch, retrieve configured secrets |
| Task role | Application code inside the container | Read/write S3, access another AWS service |

For a basic web application that only serves requests and does not call AWS APIs, a task role may not be needed. The task execution role is normally needed for private ECR image pulls and CloudWatch logging.

---

## 3. Prepare the application for production

### 3.1 Express server

The backend must serve the Vite build from its `public` directory. A suitable ES Modules setup:

```js
import express from "express";
import path from "path";
import { fileURLToPath } from "node:url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

app.use(express.json());

// Health check used by the ALB target group.
// Keep this before the SPA fallback.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Put API routes before the frontend fallback.
app.get("/api", (req, res) => {
  res.json({ message: "API working" });
});

// Serve Vite's generated assets and index.html.
app.use(express.static(publicDir));

// React Router / SPA fallback. Express 5 syntax.
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
```

Notes:

- `fileURLToPath(import.meta.url)` and `path.dirname()` recreate the `__dirname` behaviour in ES Modules.
- `express.static()` serves files such as JavaScript, CSS and images.
- The SPA fallback sends `index.html` for frontend routes.
- API routes and `/health` must be registered before the fallback.
- `0.0.0.0` makes the server reachable through the container network interface.
- The `/{*splat}` route is Express 5 syntax. If the project uses Express 4, use its compatible catch-all route syntax instead.

### 3.2 Backend package configuration

Make sure the backend package has the correct start script and ES Module setting:

```json
{
  "type": "module",
  "scripts": {
    "start": "node server.js"
  }
}
```

Keep the actual dependencies in the existing `package.json`. Commit the corresponding `package-lock.json`.

### 3.3 Multi-stage Dockerfile

This is the supplied Dockerfile's approach, with a port declaration and production dependency installation made explicit:

```dockerfile
# Stage 1: Build the Vite frontend
FROM node:20-alpine AS frontend_builder

WORKDIR /app

COPY ./frontend/package*.json ./
RUN npm ci

COPY ./frontend/ ./
RUN npm run build

# Stage 2: Install backend and assemble runtime image
FROM node:20-alpine

WORKDIR /app

COPY ./backend/package*.json ./
RUN npm ci --omit=dev

COPY ./backend/ ./
COPY --from=frontend_builder /app/dist ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
```

Important:

- This assumes folder names are lowercase: `frontend` and `backend`.
- `npm ci` requires a committed lockfile and installs the versions recorded in it.
- `npm ci --omit=dev` is suitable only if the backend's runtime dependencies are correctly listed under `dependencies`.
- The frontend build output is copied into `backend/public` in the final image.
- The final image runs the Express server. The frontend is not a second running container.
- `EXPOSE 3000` documents the container port; it does not publish the port on its own.

If your backend has no `start` script yet, add it before building.

### 3.4 `.dockerignore`

A practical starting point at the project root:

```dockerignore
**/node_modules
**/.git
**/.env
**/.env.*
!**/.env.example
**/dist
**/build
```

`**` matches paths at any directory depth. These patterns keep local dependencies, Git metadata, secrets and old build output out of the Docker build context.

Do not put real credentials in the image. Supply runtime secrets through an appropriate secrets service such as AWS Secrets Manager or Systems Manager Parameter Store, with the required IAM permissions.

### 3.5 Build and test locally

Run these commands from the project root, where the Dockerfile is located:

```bash
docker build -t fullstack-app:local .
```

Run the image:

```bash
docker run --rm -p 3000:3000 fullstack-app:local
```

Test it:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api
```

Open `http://localhost:3000` in a browser and verify the frontend routes and assets.

Do not continue to AWS until the local container works.

---

## 4. Create an ECR repository

Choose one AWS Region and use it consistently for ECR, ECS, the load balancer and the ACM certificate. Example below uses `ap-south-1` (Mumbai); replace it if you choose another Region.

### 4.1 Configure AWS CLI

Install AWS CLI v2 and configure an identity with the permissions needed for the deployment.

```bash
aws configure
```

Enter the access key, secret key, default Region and output format when prompted.

Prefer short-lived credentials or an IAM Identity Center profile when available. Never commit credentials to the repository or paste them into notes.

Set shell variables:

```bash
export AWS_REGION="ap-south-1"
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ECR_REPOSITORY="fullstack-app"
export IMAGE_TAG="v1"
```

Confirm the identity and Region:

```bash
aws sts get-caller-identity
aws configure get region
```

### 4.2 Create the ECR repository

```bash
aws ecr create-repository \
  --repository-name "$ECR_REPOSITORY" \
  --image-scanning-configuration scanOnPush=true \
  --region "$AWS_REGION"
```

The repository URI has this form:

```text
ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/REPOSITORY_NAME
```

Set it:

```bash
export ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY"
```

If the repository already exists, do not create it again. Retrieve its URI from the ECR console or AWS CLI.

### 4.3 Authenticate Docker to ECR

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login \
      --username AWS \
      --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

### 4.4 Build, tag and push the image

Run from the project root:

```bash
docker build -t "$ECR_REPOSITORY:$IMAGE_TAG" .
docker tag "$ECR_REPOSITORY:$IMAGE_TAG" "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:$IMAGE_TAG"
```

Verify the image:

```bash
aws ecr describe-images \
  --repository-name "$ECR_REPOSITORY" \
  --region "$AWS_REGION"
```

**What happened?**

1. Docker built the application image.
2. The image was tagged with the ECR repository URI.
3. Docker authenticated to ECR.
4. The image was uploaded to ECR.

ECR now stores the image. ECS will pull it when a task starts.

For repeat deployments, use a new immutable tag such as a version or commit SHA rather than relying only on `latest`.

---

## 5. Prepare networking in AWS

The ALB needs a public route to receive internet traffic. The application tasks should not be directly reachable from the public internet.

### Recommended architecture

```text
                         INTERNET
                            |
                     Internet Gateway
                            |
                 +----------+----------+
                 |                     |
          Public subnet AZ-A     Public subnet AZ-B
                 |                     |
                 +------ Public ALB ---+
                            |
                     Target Group
                            |
                 +----------+----------+
                 |                     |
         Private subnet AZ-A   Private subnet AZ-B
                 |                     |
              ECS task              ECS task
                 |                     |
                 +---- Application ----+
```

For a beginner lab, it is possible to place Fargate tasks in public subnets with public IP assignment enabled, while allowing application traffic only from the ALB Security Group. The recommended production design is private task subnets with controlled outbound access through NAT or the required VPC endpoints.

### 5.1 VPC and subnets

You can use the default VPC for a learning exercise if it has suitable subnets in at least two Availability Zones. Otherwise create a VPC with:

- One VPC CIDR range, for example `10.0.0.0/16`.
- At least two public subnets in separate AZs for the ALB.
- At least two private subnets in separate AZs for ECS tasks.
- An Internet Gateway attached to the VPC.
- Public route tables with a default route to the Internet Gateway.
- NAT Gateway(s) or suitable VPC endpoints for private task egress.

A production NAT Gateway in each AZ improves resilience but costs more. Understand the cost before creating them.

### 5.2 Security Groups

Create two Security Groups.

**ALB Security Group**

| Direction | Protocol | Port | Source |
|---|---|---:|---|
| Inbound | TCP | 80 | `0.0.0.0/0` |
| Inbound | TCP | 443 | `0.0.0.0/0` |
| Outbound | TCP | 3000 | ECS task Security Group |

**ECS Task Security Group**

| Direction | Protocol | Port | Source |
|---|---|---:|---|
| Inbound | TCP | 3000 | ALB Security Group |
| Outbound | As required | As required | Required destinations |

The important rule is that the task's port 3000 accepts traffic from the ALB Security Group, not from every public IP address.

Security Groups are stateful. Return traffic for permitted connections is automatically allowed.

---

## 6. Create the ECS cluster

1. Open the Amazon ECS console.
2. Select **Clusters**.
3. Choose **Create cluster**.
4. Give it a name, for example `fullstack-cluster`.
5. Use the Fargate/serverless option where the console asks for infrastructure or capacity.
6. Create the cluster.

A cluster is a logical grouping for ECS services and tasks. With Fargate, you do not need to create or manage EC2 container instances.

---

## 7. Create the Task Execution Role

The task execution role is used by ECS/Fargate to perform actions needed to start the container.

For this project it typically needs to:

- Pull the image from private ECR.
- Create log streams and send container logs to CloudWatch Logs.
- Retrieve configured secrets if the task definition references Secrets Manager or Parameter Store.

In IAM:

1. Open **Roles**.
2. Create a role trusted by `ecs-tasks.amazonaws.com`.
3. Attach the AWS-managed `AmazonECSTaskExecutionRolePolicy` for the standard ECR pull and CloudWatch Logs permissions.
4. Name it, for example `ecsTaskExecutionRole`.
5. Use the role in the task definition's **Task execution role** field.

The application's **Task role** is different. Create and attach one only if the application itself needs to call AWS APIs, such as reading from S3.

Do not put AWS access keys inside the container to solve permissions problems.

---

## 8. Create a CloudWatch log group

Create a log group, for example:

```text
/ecs/fullstack-app
```

You can create it in CloudWatch Logs before creating the task definition. Choose a retention period appropriate for the project so logs do not accumulate indefinitely.

The execution role must be allowed to send logs.

---

## 9. Create an ECS Task Definition

A task definition describes how ECS should run the container.

In the ECS console:

1. Open **Task definitions**.
2. Choose **Create new task definition**.
3. Name it `fullstack-task`.
4. Select **AWS Fargate** as the launch type/compute option.
5. Choose an appropriate CPU and memory combination for a small learning application.
6. Set the task execution role to `ecsTaskExecutionRole`.
7. Add a container:
   - Name: `fullstack-app`
   - Image URI: the full ECR image URI, for example `ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/fullstack-app:v1`
   - Container port: `3000`
   - Protocol: TCP
   - Log driver: `awslogs`
   - Log group: `/ecs/fullstack-app`
   - Region: the selected AWS Region
   - Stream prefix: `ecs`
8. Add environment variables that the backend needs.
9. Add secrets through Secrets Manager or Parameter Store references where appropriate.
10. Create the task definition.

The container port must match the port used by Express and the port configured in the ALB target group.

Do not add a host port mapping as though this were a local `docker run -p` command. With Fargate `awsvpc` networking, the task has its own network interface.

---

## 10. Create an Application Load Balancer

The ALB is the public entry point for the application.

1. Open the EC2 console.
2. Select **Load Balancers**.
3. Choose **Create Load Balancer**.
4. Select **Application Load Balancer**.
5. Name it, for example `fullstack-alb`.
6. Scheme: **Internet-facing**.
7. IP address type: IPv4, unless you specifically need dual-stack.
8. Select the VPC.
9. Select public subnets in at least two Availability Zones.
10. Attach the ALB Security Group.
11. Create a target group:
    - Target type: **IP addresses**
    - Protocol: HTTP
    - Port: `3000`
    - Health check protocol: HTTP
    - Health check path: `/health`
    - Success code: `200`
12. Create the ALB.

The ECS service will register task IPs with this target group. Do not manually register short-lived Fargate task IPs.

### Listener

Initially, you can use an HTTP listener on port 80 for a temporary test. For the final HTTPS setup, add an HTTPS listener on port 443 with an ACM certificate and configure HTTP to redirect to HTTPS.

---

## 11. Create the ECS Service

A service maintains the desired number of running tasks and connects the tasks to the load balancer.

1. Open your ECS cluster.
2. Choose **Create service**.
3. Compute option: Fargate.
4. Select the `fullstack-task` task definition and its revision.
5. Give the service a name, for example `fullstack-service`.
6. Desired tasks: start with `1` for a learning deployment.
7. Choose the VPC and private subnets (recommended).
8. Assign the ECS task Security Group.
9. Keep public IP assignment disabled for private subnets.
10. Under Load balancing, choose Application Load Balancer.
11. Select the existing ALB, listener and target group.
12. Map the `fullstack-app:3000` container to the target group.
13. Create the service.

Wait until the service reports a stable deployment and the target group shows healthy targets.

### If using public subnets for a first lab

If you deliberately place tasks in public subnets, enable public IP assignment for the tasks and keep the task Security Group inbound rule restricted to the ALB Security Group. This is a simpler lab network path, not the preferred production layout.

### How traffic reaches the container

1. A browser sends a request to the ALB.
2. The ALB listener accepts the request.
3. The listener forwards it to the target group.
4. The target group selects a healthy task IP.
5. The container receives the request on port 3000.
6. Express serves the frontend or handles the API route.

---

## 12. Test the deployment before adding a domain

Find the ALB's DNS name in the EC2 Load Balancers console. It looks similar to:

```text
fullstack-alb-123456.region.elb.amazonaws.com
```

Open the ALB DNS name in a browser using HTTP if the temporary HTTP listener is enabled.

Test the health endpoint:

```bash
curl -i http://YOUR-ALB-DNS-NAME/health
```

Test the API:

```bash
curl -i http://YOUR-ALB-DNS-NAME/api
```

Check:

- ECS service has the expected running task count.
- Target group targets are healthy.
- Frontend loads.
- Static JS/CSS assets load.
- Frontend routes work after refreshing the page.
- API routes return JSON rather than the frontend HTML.
- CloudWatch Logs show the application startup and request logs.

If the target is unhealthy, inspect the health-check path, container port, task logs and both Security Groups.

---

## 13. Add HTTPS using AWS Certificate Manager (ACM)

HTTPS encrypts traffic between the browser and the ALB.

### Important Region rule

For an Application Load Balancer, the ACM certificate must be in the **same AWS Region as the ALB**.

### Request a public certificate

1. Open AWS Certificate Manager (ACM) in the ALB's Region.
2. Choose **Request a public certificate**.
3. Add the domain names you intend to use, for example:
   - `example.com`
   - `www.example.com`
4. Choose **DNS validation**.
5. Request the certificate.

Use your real domain, not `example.com`, when following the actual steps.

### Validate domain ownership

ACM displays one or more CNAME records.

If using Route 53 in the same AWS account and the hosted zone is available, use **Create records in Route 53** when offered.

If DNS is managed elsewhere, copy the exact CNAME name and value from ACM and create those records at your DNS provider.

Wait until the certificate status becomes **Issued**.

Keep the ACM validation CNAME records. They are used for managed certificate renewal.

---

## 14. Add the HTTPS listener to the ALB

1. Open the ALB in the EC2 console.
2. Open **Listeners and rules**.
3. Add an HTTPS listener on port `443`.
4. Select the ACM certificate that is now Issued.
5. Set the default action to forward to the ECS target group.
6. Save the listener.

Then configure the HTTP listener on port `80` to redirect requests to HTTPS on port `443` using a permanent redirect.

Verify the ALB Security Group allows inbound TCP 443 and, if redirecting HTTP, TCP 80.

At this point, the ALB can serve HTTPS using its AWS DNS name, although browsers will not see your custom domain until DNS points to it.

---

## 15. Connect your custom domain using DNS

You need a registered domain, for example `yourdomain.com`.

DNS translates a human-readable name into the destination for network traffic.

There are two common setups.

### Option A: Use Route 53 for DNS

1. Open Route 53.
2. Create a **Public Hosted Zone** for your domain, for example `yourdomain.com`.
3. Route 53 provides a set of authoritative name servers.
4. At your domain registrar, replace the domain's current nameservers with the Route 53 nameservers.
5. Wait for the nameserver change to propagate.
6. In Route 53, create an `A` record for the root domain:
   - Record name: leave blank or use the root-domain option.
   - Record type: `A`.
   - Alias: enabled.
   - Route traffic to: Alias to Application and Classic Load Balancer.
   - Select the ALB Region and your ALB.
7. Create another `A` record for `www` with Alias enabled and point it to the same ALB.

Route 53 alias records can point both the root domain and subdomains to an ALB.

### Option B: Keep DNS at your existing provider

If your domain's DNS is managed by another provider:

1. Keep the current nameservers.
2. Add the ACM validation CNAME records at that DNS provider.
3. For a subdomain such as `www.yourdomain.com`, create a CNAME pointing to the ALB DNS name.
4. For a root/apex domain such as `yourdomain.com`, use the DNS provider's ALIAS, ANAME or CNAME-flattening feature if supported. A normal CNAME is generally not allowed at the zone apex.
5. Make sure the domain's A/alias-style record points to the ALB, not directly to a Fargate task IP.

### DNS record summary

| Name | Type | Target |
|---|---|---|
| ACM validation token | CNAME | Exact value supplied by ACM |
| `yourdomain.com` | A Alias (Route 53) | Application Load Balancer |
| `www.yourdomain.com` | A Alias (Route 53) or provider-supported CNAME | Application Load Balancer |

DNS changes take time to propagate. Do not assume a record is wrong immediately after saving it.

### Verify DNS

```bash
dig yourdomain.com
dig www.yourdomain.com
```

Then test:

```bash
curl -I https://yourdomain.com
curl -I https://www.yourdomain.com
```

Open the domain in a browser and confirm the certificate is valid and the application loads.

---

## 16. Updating the application after a code change

A new application version requires a new image and an ECS deployment.

Example using a new tag:

```bash
export IMAGE_TAG="v2"

docker build -t "$ECR_REPOSITORY:$IMAGE_TAG" .
docker tag "$ECR_REPOSITORY:$IMAGE_TAG" "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:$IMAGE_TAG"
```

Then:

1. Create a new revision of the ECS task definition using the new image tag.
2. Update the ECS service to use that task definition revision.
3. ECS starts replacement tasks and waits for health checks.
4. The ALB sends traffic to healthy targets.
5. ECS stops old tasks after the deployment progresses.

For production, use a unique version or commit SHA for every image. Do not overwrite a tag that an existing task definition is expected to represent.

---

## 17. Troubleshooting checklist

| Symptom | What to inspect |
|---|---|
| ECS task stops immediately | ECS stopped reason, task events, CloudWatch logs |
| Cannot pull ECR image | Execution role, ECR URI/Region/tag, network egress |
| Target group unhealthy | `/health` route, port 3000, task and ALB Security Groups |
| ALB returns 502/503 | Target health, container startup, app listening port |
| Frontend loads but API fails | API route, frontend API URL, CORS/proxy configuration |
| Refreshing `/dashboard` returns 404 | Express SPA fallback and static serving |
| CSS/JS assets return 404 | Vite base path and correct build copied into `public` |
| HTTPS certificate pending | Exact ACM CNAME name/value and public DNS |
| Domain does not open | Nameservers, DNS records, propagation, ALB listener |
| HTTPS certificate mismatch | Certificate SANs cover the exact hostname being visited |

Useful places to inspect:

- ECS cluster → service → Events.
- ECS service → Tasks → stopped task reason.
- CloudWatch Logs → `/ecs/fullstack-app`.
- EC2 → Target Groups → Targets → health status and reason.
- ACM → certificate status and domain validation records.
- Route 53 or your DNS provider → record values and nameservers.

---

## 18. Cost and cleanup

AWS resources can continue to incur charges even when you are not actively testing.

Potential charges include:

- Fargate task vCPU and memory while tasks run.
- Application Load Balancer while it exists.
- NAT Gateway hourly and data-processing charges.
- Public IPv4 address charges where applicable.
- ECR image storage and data transfer.
- CloudWatch log ingestion and storage.
- Route 53 hosted-zone and DNS query charges.
- Domain registration and renewal.

Before experimenting, check the current AWS pricing for your selected Region. Do not assume that creating a resource is free just because the application has little traffic.

### Cleanup after a learning deployment

If you no longer need the deployment:

1. Delete the ECS service (and wait for tasks to stop).
2. Delete the ECS cluster if empty.
3. Delete the ALB.
4. Delete the target group if no longer in use.
5. Delete unused NAT Gateways and release associated Elastic IPs.
6. Delete unused VPC endpoints if created only for the lab.
7. Delete the ECR repository if the image is no longer needed.
8. Delete unused CloudWatch log groups.
9. Remove DNS records and the hosted zone only if you no longer need them.
10. Delete the ACM certificate only after removing its ALB association and confirming it is no longer needed.

Keep your domain registration if you still want to own the domain.

---

## 19. Complete deployment checklist

- [ ] Frontend and backend work locally.
- [ ] Express serves the Vite production build from `public`.
- [ ] `/health` returns HTTP 200.
- [ ] Docker image builds successfully.
- [ ] Container works locally on port 3000.
- [ ] ECR repository created.
- [ ] Image pushed to ECR.
- [ ] VPC and subnets selected.
- [ ] ALB and ECS task Security Groups configured.
- [ ] ECS cluster created.
- [ ] Task execution role configured.
- [ ] CloudWatch log group configured.
- [ ] ECS task definition created.
- [ ] Target group and ALB created.
- [ ] ECS service created and stable.
- [ ] Target group reports healthy tasks.
- [ ] Application works through ALB DNS name.
- [ ] ACM certificate requested and Issued.
- [ ] HTTPS listener configured.
- [ ] HTTP redirects to HTTPS.
- [ ] DNS records point the domain to the ALB.
- [ ] Custom domain works over HTTPS.
- [ ] Costs and cleanup plan reviewed.

---

## 20. Key differences to remember

| Service/concept | Responsibility |
|---|---|
| Docker | Builds and runs containers |
| ECR | Stores container images |
| ECS | Schedules and manages containers |
| Fargate | Provides serverless compute for ECS tasks |
| Cluster | Logical ECS grouping |
| Task definition | Container runtime blueprint |
| Task | Running copy of a task definition |
| Service | Maintains desired task count and deployment |
| Task execution role | Lets ECS/Fargate pull images and send logs |
| Task role | Lets application code access AWS services |
| ALB | Receives and distributes HTTP/HTTPS requests |
| Target group | Holds registered destinations and health checks |
| ACM | Issues and manages TLS certificates |
| Route 53 | Hosts DNS records and routes domain names |
| CloudWatch | Stores logs and metrics |

## 21. Official documentation

Use these as the authoritative reference when AWS console labels or workflows change:

- [Amazon ECR User Guide](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html)
- [Amazon ECS Developer Guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
- [ECS task execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- [AWS Certificate Manager DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)
- [Route 53 routing to an ELB load balancer](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html)
- [CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)

---

## 22. Learning flow

Follow this order rather than trying to configure everything at once:

1. Understand Dockerfile, image, container and port mapping.
2. Build and run the full-stack image locally.
3. Create an ECR repository and push the image.
4. Understand VPC, public/private subnets and Security Groups.
5. Create the ECS cluster, execution role and task definition.
6. Deploy an ECS service.
7. Put an ALB in front of the service and verify target health.
8. Request an ACM certificate and enable HTTPS.
9. Point the custom domain to the ALB using DNS.
10. Deploy a new image version and observe the ECS rolling deployment.

**The mental model:** Docker packages the app → ECR stores the image → ECS runs it → ALB routes traffic to it → ACM secures HTTPS → DNS connects your domain to the ALB.
