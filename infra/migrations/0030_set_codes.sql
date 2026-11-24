-- Code d'extension usuel (« SL01 », « EB03 », « EV03.5 », « ME02.5 » en français ; « SM01 », « SWSH03 », « SV03.5 »
-- en anglais) : celui qu'on écrit sur les étiquettes et qu'on tape dans les recherches. Il se déduit de l'identifiant
-- TCGdex de la série et de la langue ; une série hors schéma prend son abréviation officielle, ou son identifiant.
-- Un code saisi à la main pour une série le remplace.
alter table catalog_sets add column code_override text check (code_override is null or length(code_override) between 1 and 20);

create function set_code(p_set_id text, p_language text, p_override text, p_abbreviation text) returns text
language plpgsql immutable as $$
declare
  m text[];
  prefix text;
  num text;
begin
  if nullif(trim(p_override), '') is not null then
    return trim(p_override);
  end if;
  m := regexp_match(lower(p_set_id), '^(me|sv|swsh|sm|xy|bw)(\d+)(\.\d+)?$');
  if m is null then
    return coalesce(nullif(p_abbreviation, ''), upper(p_set_id));
  end if;
  prefix := case when p_language = 'fr'
    then case m[1] when 'sv' then 'EV' when 'swsh' then 'EB' when 'sm' then 'SL' when 'bw' then 'NB' else upper(m[1]) end
    else upper(m[1]) end;
  num := m[2];
  -- Soleil et Lune, Épée et Bouclier : « sm35 », « swsh45 », « sm115 » sont les demi-séries 3.5, 4.5, 11.5.
  if m[3] is null and m[1] in ('sm', 'swsh') and num::int > 12 and right(num, 1) = '5' then
    return prefix || lpad(left(num, -1), 2, '0') || '.5';
  end if;
  return prefix || lpad(ltrim(num, '0'), 2, '0') || coalesce(m[3], '');
end $$;

-- Clé de comparaison d'un code saisi : « me 2.5 », « ME02.5 » et « me2,5 » se retrouvent.
create function set_code_key(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(upper(replace(p, ',', '.')), '[^A-Z0-9.]', '', 'g'), '([A-Z])0+(\d)', '\1\2', 'g')
$$;
