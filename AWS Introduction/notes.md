# AWS Introduction

> Foundations for understanding cloud infrastructure before deploying applications.
>
> **Scope:** This folder covers general AWS concepts. The hands-on Docker, ECR, ECS, load balancer, HTTPS and custom-domain deployment project lives in **AWS ECR & ECS**.

## 1. What is cloud computing?

Cloud computing is the delivery of computing resources over the internet. Instead of buying and maintaining physical servers, you rent resources from a cloud provider when you need them.

Common resources include:

- Compute: virtual machines and container services.
- Storage: object, block and file storage.
- Databases: managed relational and NoSQL databases.
- Networking: private networks, routing and firewalls.
- Monitoring: logs, metrics and alerts.

### Why use cloud computing?

- **Scalability:** increase or decrease resources as demand changes.
- **Availability:** deploy across multiple data centres and Availability Zones.
- **Pay-as-you-go:** pay for the resources you consume.
- **Managed services:** AWS operates much of the underlying infrastructure.

## 2. What is AWS?

Amazon Web Services (AWS) is a cloud platform offering infrastructure and managed services.

A few services to recognize:

| Service | Purpose |
|---|---|
| EC2 | Virtual servers |
| S3 | Object storage |
| VPC | Isolated virtual network |
| IAM | Identity and access management |
| RDS | Managed relational databases |
| CloudWatch | Logs, metrics and alarms |
| Route 53 | DNS and domain routing |
| ACM | Managed TLS certificates |
| ECR | Container image registry |
| ECS | Container orchestration |

ECR and ECS are studied and used in the practical deployment project in the **AWS ECR & ECS** folder.

## 3. AWS global infrastructure

### Region

A Region is a separate geographic area where AWS operates infrastructure, for example `ap-south-1` (Mumbai).

Choose a Region based on:

- Proximity to users and latency.
- Service availability.
- Compliance and data residency.
- Pricing.

Resources are generally regional. For example, an ECR repository and an ECS service are created in a particular Region.

### Availability Zone (AZ)

An Availability Zone is an isolated location within a Region. A Region contains multiple AZs.

Deploying across more than one AZ can improve availability because a failure in one AZ does not necessarily affect the others.

### Edge locations

AWS uses edge locations to deliver content and services closer to users. CloudFront uses this global edge network.

## 4. IAM: Identity and Access Management

IAM controls **who can do what** in an AWS account.

### IAM user

An IAM user represents a person or application identity with long-term credentials. Avoid creating long-lived access keys unless there is a specific need.

### IAM role

An IAM role is an identity with permissions that can be assumed by a trusted user or AWS service. It provides temporary credentials rather than requiring an application to store permanent access keys.

### IAM policy

A policy is a JSON document that defines allowed or denied actions on AWS resources.

Important terms:

- **Principal:** the identity making a request.
- **Action:** the operation, such as reading an S3 object.
- **Resource:** the AWS resource the action applies to.
- **Effect:** `Allow` or `Deny`.

### Security practices

- Do not use root-user credentials for everyday work.
- Enable MFA on the root user.
- Use least privilege: grant only the permissions required.
- Do not commit access keys, secret keys or `.env` files.
- Prefer IAM roles and temporary credentials for workloads.

> ECS-specific roles (task role and task execution role) are explained in the deployment notes, where their different responsibilities become clear.

## 5. EC2: Elastic Compute Cloud

EC2 provides virtual machines called **instances**.

You choose an instance type, operating system image (AMI), storage, network and security configuration.

Important terms:

- **AMI:** a template used to launch an instance.
- **Instance type:** defines CPU, memory and other capacity.
- **Key pair:** used for secure SSH access where configured.
- **EBS:** persistent block storage volumes for EC2.
- **Elastic IP:** a static public IPv4 address that can be associated with supported resources.

EC2 is infrastructure you manage more directly. With a managed container service such as ECS on Fargate, you do not manage the underlying container host machines.

## 6. VPC: Virtual Private Cloud

A VPC is a logically isolated virtual network in an AWS Region. You choose its private IP address range using CIDR notation.

Example:

```text
VPC CIDR: 10.0.0.0/16
```

A VPC provides control over network addressing, subnets, route tables and network security.

Think of a VPC as the network boundary for a group of AWS resources.

## 7. Subnets

A subnet is a smaller IP network inside a VPC. Each subnet belongs to one Availability Zone.

Example:

```text
VPC: 10.0.0.0/16
├── Public subnet:  10.0.1.0/24
└── Private subnet: 10.0.2.0/24
```

### Public subnet

A subnet is considered public when its route table has a route to an Internet Gateway. A resource still needs suitable public addressing and security rules to communicate directly with the internet.

### Private subnet

A private subnet does not have a direct route to an Internet Gateway. Resources can use a NAT Gateway or VPC endpoints for specific outbound access, depending on the design.

Common uses:

- Public subnet: internet-facing load balancers.
- Private subnet: application tasks, databases and internal services.

## 8. Internet Gateway and NAT Gateway

### Internet Gateway (IGW)

An Internet Gateway attaches to a VPC and allows resources with suitable public IP addressing and routing to communicate with the internet.

A route table commonly contains:

```text
0.0.0.0/0 -> Internet Gateway
```

### NAT Gateway

A NAT Gateway allows resources in private subnets to initiate outbound IPv4 connections to the internet without accepting unsolicited inbound internet connections.

For example, a private workload may need to download updates or reach an external API.

NAT Gateways incur charges. VPC endpoints may be a better option for private access to supported AWS services.

## 9. Route tables

A route table determines where network traffic from a subnet is sent.

Example:

| Destination | Target | Meaning |
|---|---|---|
| `10.0.0.0/16` | local | Traffic within the VPC |
| `0.0.0.0/0` | Internet Gateway | Default route to the internet |

A subnet is associated with a route table. The routes determine whether it has a path to an Internet Gateway, NAT Gateway or another network.

## 10. Security Groups

A Security Group is a stateful virtual firewall attached to supported AWS resources or network interfaces.

It controls:

- **Inbound rules:** traffic allowed into the resource.
- **Outbound rules:** traffic allowed out of the resource.

Example:

| Type | Port | Source | Purpose |
|---|---:|---|---|
| HTTP | 80 | As required | HTTP traffic |
| HTTPS | 443 | As required | HTTPS traffic |
| SSH | 22 | Your trusted IP only | Administration |

Security Groups are stateful: response traffic for an allowed connection is automatically permitted.

**Important:** do not expose SSH or application ports to `0.0.0.0/0` without a clear reason. Prefer narrow sources and service-to-service Security Group references.

## 11. Network ACLs (NACLs)

A Network ACL is an optional subnet-level network filter.

| Security Group | Network ACL |
|---|---|
| Attached to network interfaces/resources | Applies at subnet boundary |
| Stateful | Stateless |
| Allows rules only | Supports allow and deny rules |
| Return traffic is automatically considered | Return traffic needs matching rules |

Security Groups are usually the main control used for application-level access in a basic VPC deployment.

## 12. Storage and databases

### S3: Simple Storage Service

S3 is object storage. It is commonly used for:

- Images and uploaded files.
- Backups and archives.
- Static assets.
- Data lakes and logs.

An S3 bucket is not the same thing as a normal filesystem directory.

### EBS: Elastic Block Store

EBS provides block storage volumes commonly attached to EC2 instances.

### RDS: Relational Database Service

RDS is a managed relational database service. It supports database engines such as PostgreSQL and MySQL.

A typical architecture keeps a database in private subnets and allows access only from the application tier.

## 13. CloudWatch

CloudWatch is used to observe AWS resources and applications.

It provides:

- **Metrics:** numeric measurements over time.
- **Logs:** application and service log events.
- **Alarms:** actions or notifications when a metric crosses a threshold.
- **Dashboards:** visual summaries of metrics.

In the ECS project, container logs are sent to CloudWatch Logs so deployment and runtime errors can be inspected.

## 14. Shared Responsibility Model

AWS is responsible for security **of** the cloud, while customers are responsible for security **in** the cloud. The exact split depends on the service.

Examples:

- AWS secures the physical data centres and underlying infrastructure.
- You manage IAM permissions, application secrets, network rules and application code.
- With a managed service such as Fargate, AWS manages more of the host infrastructure than with self-managed EC2.

## 15. Quick revision

| Term | Remember it as |
|---|---|
| Region | Geographic AWS area |
| Availability Zone | Isolated location inside a Region |
| IAM | Who can do what |
| EC2 | Virtual machine |
| VPC | Isolated virtual network |
| Subnet | Smaller network inside a VPC |
| IGW | VPC connection to the internet |
| NAT Gateway | Outbound internet access for private subnets |
| Route table | Where network traffic goes |
| Security Group | Stateful resource-level firewall |
| NACL | Stateless subnet-level filter |
| S3 | Object storage |
| EBS | Block storage |
| RDS | Managed relational database |
| CloudWatch | Metrics, logs and alarms |

## 16. Where to go next

Continue with **AWS ECR & ECS/notes.md** to learn how these building blocks are used to deploy a Dockerized frontend/backend application, expose it through an Application Load Balancer, enable HTTPS and connect a custom domain.
