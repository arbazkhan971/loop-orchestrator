// Reference-level validation that the Zod schema can't express on its own:
// roles must point at real providers/repositories, and workflow stages must
// point at real roles and real stages. All problems are returned together so a
// user fixes them in one pass.

import { ProjectConfig, RootConfig, WorkflowConfig } from "./schema.js";

export function validateWorkflow(project: ProjectConfig, workflow: WorkflowConfig): string[] {
  const errors: string[] = [];
  const roleNames = new Set(project.roles.map((role) => role.name));
  const stageNames = new Set(workflow.stages.map((stage) => stage.name));

  for (const stage of workflow.stages) {
    if (!roleNames.has(stage.role)) {
      errors.push(`Stage "${stage.name}" references unknown role "${stage.role}".`);
    }
    for (const dep of stage.dependsOn) {
      if (dep === stage.name) errors.push(`Stage "${stage.name}" depends on itself.`);
      else if (!stageNames.has(dep)) errors.push(`Stage "${stage.name}" depends on unknown stage "${dep}".`);
    }
  }
  return errors;
}

export function validateProject(project: ProjectConfig): string[] {
  const errors: string[] = [];
  const providerNames = new Set(Object.keys(project.providers));
  const repoNames = new Set(project.repositories.map((repo) => repo.name));

  for (const role of project.roles) {
    if (!providerNames.has(role.provider)) {
      errors.push(`Role "${role.name}" references unknown provider "${role.provider}".`);
    }
    for (const repo of role.repositories) {
      if (!repoNames.has(repo)) errors.push(`Role "${role.name}" references unknown repository "${repo}".`);
    }
  }

  for (const workflow of project.workflows) {
    errors.push(...validateWorkflow(project, workflow).map((error) => `[workflow ${workflow.name}] ${error}`));
  }
  return errors;
}

export function validateConfig(config: RootConfig): string[] {
  return config.projects.flatMap((project) => validateProject(project).map((error) => `[project ${project.name}] ${error}`));
}
