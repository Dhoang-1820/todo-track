/* Plan data for the AI-200 tracker. Edit freely: the app reads everything from here. */
window.PLAN = {
  startDefault: "2026-11-02",
  examWeekDefault: 20,
  passTarget: 80,
  domains: {
    D1: { name: "Containerised solutions", weight: "20-25%" },
    D2: { name: "AI data management", weight: "25-30%" },
    D3: { name: "Connect and consume services", weight: "20-25%" },
    D4: { name: "Secure, monitor, troubleshoot", weight: "20-25%" },
    EX: { name: "Exam sprint", weight: "" },
    PROD: { name: "Production depth", weight: "" }
  },
  phases: [
    { id: "A", name: "Containers on Azure", domain: "D1", from: 1, to: 7 },
    { id: "B", name: "AI data and vector search", domain: "D2", from: 8, to: 11 },
    { id: "C", name: "Connect and consume services", domain: "D3", from: 12, to: 14 },
    { id: "D", name: "Secure, monitor, troubleshoot", domain: "D4", from: 15, to: 18 },
    { id: "E", name: "Exam sprint", domain: "EX", from: 19, to: 20 },
    { id: "F", name: "Production depth and portfolio", domain: "PROD", from: 21, to: 26 }
  ],
  weeks: [
    {
      n: 1, title: "Setup and Azure basics",
      theory: ["Read the AI-200 study guide; map each skill to a Learn path", "Azure basics: subscriptions, resource groups, RBAC", "Azure CLI and Cloud Shell", "Container concepts: images, layers, registries"],
      labs: ["Create the free account, budget alert, install az CLI", "Create a tagged resource group with az", "Create the ai-platform repo with an architecture README", "Run a hello-world container locally"],
      retr: "Write 10 flashcards from the skills outline. Explain RBAC out loud.",
      project: { title: "Foundation setup", steps: ["Install az, Docker, VS Code, Copilot", "Repo and README with the target architecture", "Build a 20-card deck from the skills measured", "Teardown check: list resources, confirm none left"] },
      ai: "Ask Claude to turn each skills-measured bullet into flashcards and a checklist. Turn on Copilot in VS Code."
    },
    {
      n: 2, title: "Docker for your app",
      theory: ["Images, layers and build cache", "Multi-stage builds and non-root users", "Networking, volumes, compose", "Health checks and container logging"],
      labs: ["Dockerfile for the Angular app", "Dockerfile for the API (Spring Boot or FastAPI)", "docker-compose with Postgres", "Add a health check and run as non-root"],
      retr: "Explain layer caching. List 5 Dockerfile best practices from memory.",
      project: { title: "Containerise the app", steps: ["Both images build and run", "Compose stack starts with one command", "Scan images with trivy or docker scout", "Write run notes in the README"] },
      ai: "Let Copilot draft the Dockerfile, then ask Claude to review size, caching and security. Explain each line back to it."
    },
    {
      n: 3, title: "Container Registry and CI",
      theory: ["ACR: SKUs, tags, authentication", "ACR Tasks and az acr build", "Image scanning and retention", "GitHub Actions for containers"],
      labs: ["Create ACR and push an image", "Build with az acr build", "Workflow: build and push on commit", "Add tests and an image scan to the workflow"],
      retr: "Which ACR authentication methods exist and when do you use each?",
      project: { title: "CI to ACR", steps: ["Pipeline builds, tests and pushes", "OIDC login to Azure (no stored secrets)", "Tag images with the commit SHA", "Teardown and cost check"] },
      ai: "Have Claude write the workflow YAML. Break it on purpose and use AI to read the failing logs."
    },
    {
      n: 4, title: "Azure Container Apps",
      theory: ["Environments, revisions, ingress", "Secrets and environment variables", "Managed identity pulling from ACR", "Logs and traffic splitting"],
      labs: ["Deploy the API with the CLI", "Deploy the front end and connect it", "Switch ACR pull to managed identity", "Split traffic between two revisions"],
      retr: "Revision versus replica. What does ingress do?",
      project: { title: "Deploy to Container Apps", steps: ["Deploy both services", "Repeat the deployment in Bicep", "Add an env var and a secret", "Teardown"] },
      ai: "Ask Copilot to scaffold the Bicep. Ask Claude to explain each property and which ones an exam might test."
    },
    {
      n: 5, title: "Scaling with KEDA",
      theory: ["Scale rules: HTTP, queue, custom (KEDA)", "Scale to zero and cold starts", "Dapr basics in Container Apps", "Probes and resource limits"],
      labs: ["Add an HTTP scale rule", "Add a queue scale rule", "Load test with k6 or hey", "Tune min and max replicas"],
      retr: "When does scale-to-zero hurt? Name three scale triggers.",
      project: { title: "Load test and scale", steps: ["Write a k6 script", "Watch replicas scale in metrics", "Record results in the README", "Teardown"] },
      ai: "Ask Claude to design the load test and interpret the scaling output."
    },
    {
      n: 6, title: "AKS and choosing a host",
      theory: ["Pods, deployments, services, ingress", "HPA and the KEDA add-on", "App Service for containers and slots", "Container Apps vs App Service vs AKS"],
      labs: ["Create a small AKS cluster", "Deploy with kubectl", "Package with Helm", "Deploy to App Service with a staging slot"],
      retr: "Fill a decision table: which service for which workload?",
      project: { title: "Same app, three hosts", steps: ["Deploy to AKS", "Deploy to App Service and swap a slot", "Compare cost, effort and scaling", "Delete the AKS cluster the same night"] },
      ai: "Have Copilot generate manifests. Ask Claude 'what breaks if...' questions and answer before reading its reply."
    },
    {
      n: 7, title: "Infrastructure as code and pipeline",
      theory: ["Bicep modules and parameters", "Terraform azurerm basics and state", "Environments and approvals in pipelines", "Review all container topics"],
      labs: ["Bicep module for ACR and Container Apps", "The same stack in Terraform", "Pipeline deploys the dev environment", "Mixed quiz on Domain 1 (40 questions)"],
      retr: "Bicep vs Terraform: three differences from memory.",
      project: { title: "One-command deploy", steps: ["One pipeline deploys infra then app", "Add a what-if or plan step on pull requests", "Document the rollback", "Teardown"] },
      ai: "Ask Claude to diff your Bicep and Terraform and flag resources that are not equivalent.",
      quiz: "Mixed quiz 1: Domain 1 (40 questions)"
    },
    {
      n: 8, title: "Embeddings and RAG",
      theory: ["Embeddings and similarity metrics", "Chunking strategies", "Azure OpenAI / Foundry: deployments, quotas, APIs", "RAG request flow and grounding"],
      labs: ["Create a model deployment and call the chat API", "Create embeddings for sample documents", "Chunk documents and store vectors in a file", "Answer questions with retrieved context"],
      retr: "Draw the RAG flow from memory. Explain cosine vs dot product.",
      project: { title: "Mini RAG script", steps: ["Python script: chunk, embed, retrieve, answer", "Write 15 test questions with expected sources", "Measure retrieval hit rate", "Teardown"] },
      ai: "Ask Claude to explain chunking trade-offs and to generate test documents and questions."
    },
    {
      n: 9, title: "PostgreSQL with pgvector", light: true,
      theory: ["pgvector types and distance operators", "HNSW vs IVFFlat indexes", "Azure Database for PostgreSQL: setup and security", "Filtering together with vector search"],
      labs: ["Stand up PostgreSQL with pgvector", "Load embeddings into a table", "Build an HNSW index and compare query time", "Combine a metadata filter with vector search"],
      retr: "HNSW vs IVFFlat: when do you use each?",
      project: { title: "pgvector retrieval", steps: ["Load vectors and query them", "Add an HNSW index; compare speed and recall", "Add a metadata filter", "Teardown"] },
      ai: "Use your Oracle background: ask Claude to map index trade-offs onto what you know, and to review your SQL."
    },
    {
      n: 10, title: "Cosmos DB vector search",
      theory: ["Data modelling and partition keys", "Request units and throughput", "Vector indexing policies and queries", "Change feed"],
      labs: ["Create a serverless Cosmos DB account", "Model a container with a partition key", "Add a vector index and query it", "Read the change feed"],
      retr: "Why does the partition key matter? Estimate the RU cost of a read.",
      project: { title: "Retrieval on Cosmos DB", steps: ["Reuse the pgvector dataset", "Compare latency, cost and filtering", "Write a comparison table in the README", "Teardown"] },
      ai: "Ask Claude to critique your partition key and estimate RU cost."
    },
    {
      n: 11, title: "Redis, semantic cache, hybrid search",
      theory: ["Managed Redis: caching patterns, TTL, eviction", "Redis vector search", "Semantic caching", "Hybrid search and reranking"],
      labs: ["Create Managed Redis and cache API responses", "Store and query vectors", "Add a semantic cache before the LLM call", "Measure hit rate and latency saved"],
      retr: "Cache-aside vs write-through. When is a semantic cache unsafe?",
      project: { title: "Semantic cache and hybrid search", steps: ["Add the cache layer", "Hybrid keyword and vector query in Postgres", "Eval set: hit rate and answer quality", "Teardown"] },
      ai: "Have Copilot write the cache layer. Ask Claude to design the eval set.",
      quiz: "Mixed quiz 2: Domains 1 and 2 (40 questions)"
    },
    {
      n: 12, title: "Azure Functions",
      theory: ["Triggers and bindings", "Hosting plans and cold starts", "Durable Functions patterns", "Function identity and configuration"],
      labs: ["Blob-triggered ingestion function", "Add embeddings and the database write", "Durable chaining of the steps", "Deploy with CI"],
      retr: "Name 5 triggers and 3 bindings. Consumption vs premium plan?",
      project: { title: "Ingestion pipeline", steps: ["Upload a document, chunk, embed, store", "Add structured logging", "Test with 20 documents", "Teardown"] },
      ai: "Have Copilot scaffold the function. Ask Claude to review idempotency and error handling."
    },
    {
      n: 13, title: "Messaging and SDK auth",
      theory: ["Service Bus queues vs topics", "Dead-letter, sessions, duplicates", "Event Grid vs Event Hubs vs Service Bus", "Azure SDKs and DefaultAzureCredential"],
      labs: ["Send and receive with the SDK", "Add dead-letter handling", "Publish an event to Event Grid", "Replace keys with DefaultAzureCredential"],
      retr: "Which messaging service fits which scenario? List the delivery guarantees.",
      project: { title: "Reliable ingestion", steps: ["Move ingestion to Service Bus", "Dead-letter queue and retry policy", "Event Grid notification when indexing completes", "Teardown"] },
      ai: "Ask Claude for failure scenarios (poison message, duplicates) and test each one."
    },
    {
      n: 14, title: "Tet buffer and integration review", light: true,
      theory: ["API Management basics", "Retry, throttling and idempotency", "Review weak spots from Domains 1 to 3", "Flashcard catch-up"],
      labs: ["Put the API behind API Management (or review it)", "Add retries with backoff", "Fix gaps found in the quizzes", "Optional: rest"],
      retr: "Explain retry with backoff and why idempotency matters.",
      project: { title: "Catch-up (optional)", steps: ["Redo one lab you got wrong", "Update your notes", "Rest"] },
      ai: "Ask Claude to build a gap list from your wrong answers.",
      quiz: "Mixed quiz 3: Domains 1 to 3 (40 questions)"
    },
    {
      n: 15, title: "Identity and secrets", light: true,
      theory: ["Entra ID, service principals, managed identity", "RBAC vs access policies", "Key Vault: secrets, keys, certificates", "Least privilege"],
      labs: ["Enable managed identity on the app", "Grant role assignments in Bicep", "Move secrets to Key Vault", "Key Vault references in Container Apps"],
      retr: "System vs user-assigned identity. Which role for which data service?",
      project: { title: "Remove all secrets", steps: ["Managed identity for ACR, database and OpenAI", "Key Vault references", "Scan the repo for secrets", "Teardown"] },
      ai: "Ask Claude to generate role assignments in Bicep. Verify least privilege yourself."
    },
    {
      n: 16, title: "Network security",
      theory: ["Private endpoints and private DNS", "VNet integration", "Firewalls and service tags", "Securing AI endpoints"],
      labs: ["Private endpoint for Postgres", "Link a private DNS zone", "VNet integration for Container Apps", "Verify the app still works"],
      retr: "Why does private DNS matter? Draw the private endpoint path.",
      project: { title: "Lock down the platform", steps: ["Private endpoints for data services", "Private access to the AI endpoint", "Test from inside and outside the network", "Teardown"] },
      ai: "Ask Claude to explain private DNS step by step, then use it to debug your own failures."
    },
    {
      n: 17, title: "Monitoring and KQL",
      theory: ["Azure Monitor and Log Analytics", "Application Insights and OpenTelemetry", "KQL basics", "Alerts and availability tests"],
      labs: ["Add OpenTelemetry to the API", "Write 5 KQL queries", "Build a workbook", "Create alerts"],
      retr: "Write a KQL query for error rate from memory.",
      project: { title: "Observability dashboard", steps: ["Latency, errors, token usage, cost per request", "Alerts on error rate and queue backlog", "Break the app five ways; diagnose from telemetry only", "Teardown"] },
      ai: "Have Claude write KQL from plain-English questions. Verify each query by hand."
    },
    {
      n: 18, title: "Troubleshooting and responsible AI",
      theory: ["Container troubleshooting: logs, probes, OOM, image pulls", "Responsible AI and content safety", "Prompt injection and data privacy", "Quotas, rate limits, retries for AI endpoints"],
      labs: ["Diagnose a failed revision", "Add content filtering", "Write prompt-injection test cases", "Golden test set with automatic scoring"],
      retr: "List 6 container failure modes and the log that reveals each.",
      project: { title: "Evaluation harness", steps: ["Golden set of 30 questions and answers", "Automatic scoring script", "Adversarial prompts", "Teardown"] },
      ai: "Have Claude write adversarial prompts. Run them and log the failures.",
      quiz: "Mixed quiz 4: all domains (60 questions)"
    },
    {
      n: 19, title: "Exam sprint: practice exams",
      theory: ["Timed practice exam 1 (Monday, 120 min)", "Review every wrong answer by domain", "Re-study the weakest domain", "Re-study the second weakest domain"],
      labs: ["Redo the lab behind each missed topic", "Portal practice: 20 min on each weak service", "Flashcards: all missed items", "Timed 40-question set"],
      retr: "Explain each missed answer without notes.",
      project: { title: "Weak-spot labs", steps: ["Rebuild from scratch the lab you scored worst on", "Timed practice exam 2", "Update your one-page cheat sheet", "Rest"] },
      ai: "Ask Claude to interview you on your weakest domain, with no hints.",
      quiz: "Timed practice exams 1 and 2 (aim for 80% or more)"
    },
    {
      n: 20, title: "Exam week", light: true,
      theory: ["Flashcards only", "Weak-domain review (60 min)", "Rest", "Exam logistics: ID, room, system check"],
      labs: ["Light portal practice", "Light portal practice", "Rest", "Rest"],
      retr: "Run through your cheat sheet from memory.",
      project: { title: "Exam", steps: ["Sit the exam (book it by week 14)", "Tear down all resources", "Rest and celebrate"] },
      ai: "No new AI-generated material this week. Only a 15-minute flashcard run.",
      quiz: "Exam window: Friday to Sunday"
    },
    {
      n: 21, title: "Capstone: architecture and cost",
      theory: ["Reference architecture for RAG on Azure", "Reliability and failure domains", "Cost management and budgets", "Well-Architected review for AI workloads"],
      labs: ["Draw the architecture diagram", "Estimate the monthly cost", "Add budgets and tags in IaC", "Define SLOs"],
      retr: "Explain your architecture in 2 minutes without notes.",
      project: { title: "Capstone: infrastructure", steps: ["One IaC deployment of the whole platform", "Separate dev and prod environments", "Cost estimate in the README", "Teardown"] },
      ai: "Ask Claude to review the architecture as a senior reviewer: cost, security, reliability."
    },
    {
      n: 22, title: "Capstone: hardening",
      theory: ["Evaluation methods for RAG", "Caching and batching to cut cost", "Rate limiting and backpressure", "Data lifecycle and privacy"],
      labs: ["Add rate limiting", "Run the evaluation job in CI", "Add retry and a circuit breaker", "Redact personal data in logs"],
      retr: "List five ways to reduce AI cost without hurting quality.",
      project: { title: "Capstone: hardening", steps: ["Evaluation gate in the pipeline", "Rate limits and circuit breaker", "Log redaction", "Teardown"] },
      ai: "Have Claude red-team your API and list the findings. Fix the top three."
    },
    {
      n: 23, title: "Capstone: operations",
      theory: ["SLIs, SLOs and alert design", "Runbooks and incident response", "Deployment strategies: blue-green, canary", "Backup and recovery for data services"],
      labs: ["Write alerts from the SLOs", "Write a runbook for three incidents", "Canary release with traffic splitting", "Restore a database backup"],
      retr: "Describe your rollback in 60 seconds.",
      project: { title: "Capstone: operations", steps: ["Alerts and dashboards finished", "Runbook in the repo", "Canary release rehearsal", "Teardown"] },
      ai: "Ask Claude to role-play an incident and test your runbook step by step."
    },
    {
      n: 24, title: "Capstone: failure testing",
      theory: ["Chaos and failure testing basics", "Load testing AI endpoints", "Capacity planning and quotas", "Security review checklist"],
      labs: ["Kill a replica and watch recovery", "Throttle the AI endpoint and observe", "Load test with realistic prompts", "Fix the findings"],
      retr: "What fails first under load in your system, and why?",
      project: { title: "Capstone: break it", steps: ["Run three failure experiments", "Record what you learned", "Fix and rerun", "Teardown"] },
      ai: "Ask Claude to propose failure experiments ranked by risk. Run the top three."
    },
    {
      n: 25, title: "Portfolio and write-up", light: true,
      theory: ["Architecture decision records", "Writing a clear README", "Telling the project story", "Plan the next certification or skill"],
      labs: ["Write three decision records", "Record a 5-minute demo", "Draft a blog or LinkedIn post", "Tidy the repository"],
      retr: "Pitch the project in 90 seconds.",
      project: { title: "Publish the capstone", steps: ["Repo public and tidy", "Demo recorded", "Post published"] },
      ai: "Ask Claude to interview you as if for a Cloud AI engineer role, then polish your post and CV bullets."
    },
    {
      n: 26, title: "Buffer and next step", light: true,
      theory: ["Retake slot or catch-up if needed", "Decide: AI-102 or deeper MLOps", "Plan the next 3 months", "Rest"],
      labs: ["Catch-up lab", "Catch-up lab", "Rest", "Rest"],
      retr: "List three skills you now use without notes.",
      project: { title: "Plan the next quarter", steps: ["Pick the next goal", "Schedule it", "Rest"] },
      ai: "Ask Claude to draft a 3-month plan for your chosen next goal."
    }
  ]
};
