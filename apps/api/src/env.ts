/** Variables posées sur chaque requête par le contrôle d'accès de l'API (app.ts). */
export type Env = {
  Variables: {
    actor: string;
    accountId: string;
    /** L'utilisateur de la session (requête d'un navigateur) ; absent pour un script, une tâche planifiée ou un agent. */
    user?: { id: string; email: string; name: string; role: string; plan: string | null };
  };
};
