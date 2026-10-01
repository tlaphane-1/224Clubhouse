-- Owner confirmed 2026-10-01: the street is "Rondebult Road" (was "Rondebult Ave").
alter table events alter column location set default '224 Rondebult Road, Libradene, Boksburg';
update events set location = replace(location, 'Rondebult Ave', 'Rondebult Road')
 where location like '%Rondebult Ave%';
