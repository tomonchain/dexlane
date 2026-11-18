-- Mot de passe du propriétaire (owner unique au MVP) pour la connexion à l'application web.
-- Une seule ligne ; le jeton d'API reste la clé de secours pour définir ou réinitialiser le mot de passe.
create table owner_credentials (
  id              boolean primary key default true check (id),
  password_hash   text not null,
  -- Incrémenté à chaque changement de mot de passe : invalide les sessions ouvertes auparavant.
  session_version integer not null default 1,
  -- Essais infructueux consécutifs et verrouillage temporaire (frein aux essais en série).
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
