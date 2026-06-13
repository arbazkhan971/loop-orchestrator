import { z } from "zod";

export const AuthSchema = z.object({
  mode: z.enum(["auto", "subscription", "api-key", "env"]).default("auto"),
  env: z.string().optional(),
  configured: z.boolean().default(false),
  notes: z.string().optional()
});

export const ProviderSchema = z.object({
  type: z.enum(["claude", "codex", "gemini", "custom"]),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  model: z.string().optional(),
  effort: z.string().optional(),
  dangerouslySkipPermissions: z.boolean().default(false),
  yolo: z.boolean().default(false),
  auth: AuthSchema.default({
    mode: "auto",
    configured: false
  }),
  promptMode: z.enum(["interactive", "stdin", "argument"]).default("interactive"),
  env: z.record(z.string(), z.string()).default({})
});

export const RepositorySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.enum(["frontend", "backend", "fullstack", "docs", "qa", "release", "other"]).default("other"),
  defaultBranch: z.string().default("main"),
  protectedBranches: z.array(z.string()).default(["main", "production"])
});

export const RoleSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  provider: z.string().min(1),
  repositories: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  guardrails: z.array(z.string()).default([]),
  autoStart: z.boolean().default(true)
});

export const LoopSchema = z.object({
  name: z.string().min(1),
  cadenceMinutes: z.number().int().positive().default(30),
  maxIterations: z.number().int().positive().default(8),
  stopWhen: z.array(z.string()).default(["tests pass", "pull request opened", "review complete"])
});

export const StageSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  completeWhen: z.array(z.string()).default(["pane-idle:120"]),
  failWhen: z.array(z.string()).default([]),
  optional: z.boolean().default(false)
});

export const WorkflowSchema = z.object({
  name: z.string().min(1),
  cadenceSeconds: z.number().int().positive().default(30),
  maxIterations: z.number().int().positive().default(50),
  stages: z.array(StageSchema).min(1)
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  brief: z.string().default("brief.md"),
  workingDir: z.string().default("."),
  safetyMode: z.enum(["review", "workspace-write", "full-auto"]).default("workspace-write"),
  providers: z.record(z.string(), ProviderSchema),
  repositories: z.array(RepositorySchema).default([]),
  roles: z.array(RoleSchema).min(1),
  loops: z.array(LoopSchema).default([]),
  workflows: z.array(WorkflowSchema).default([])
});

export const RootConfigSchema = z.object({
  version: z.literal(1),
  defaults: z.object({
    namespace: z.string().default("loop"),
    dashboardPort: z.number().int().positive().default(4318),
    promptDir: z.string().default(".loop/prompts"),
    runDir: z.string().default(".loop/runs")
  }).default({
    namespace: "loop",
    dashboardPort: 4318,
    promptDir: ".loop/prompts",
    runDir: ".loop/runs"
  }),
  projects: z.array(ProjectSchema).min(1)
});

export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type RepositoryConfig = z.infer<typeof RepositorySchema>;
export type RoleConfig = z.infer<typeof RoleSchema>;
export type LoopConfig = z.infer<typeof LoopSchema>;
export type StageConfig = z.infer<typeof StageSchema>;
export type WorkflowConfig = z.infer<typeof WorkflowSchema>;
export type ProjectConfig = z.infer<typeof ProjectSchema>;
export type RootConfig = z.infer<typeof RootConfigSchema>;
