// 1. Ausgangspunkt: Den spezifischen Job holen
MATCH (j:Job) WHERE j.id = "b902fce8-2b30-492d-ae94-bc4f5d275960"
MATCH (j)-[:REQUIRES_SKILL]->(jobSkill:Skill)

// 2. Alle Kandidaten finden, die irgendeinen Skill haben
MATCH (c:Candidate)-[:HAS_SKILL]->(candSkill:Skill)

// Hier reichen wir j.title und j.company an die nächste Stufe weiter
WITH j, j.title AS jobTitle, j.company AS companyName, jobSkill, c, candSkill

// 3. Berechnen, ob der Skill exakt übereinstimmt oder semantisch ähnlich ist
WITH jobTitle, companyName, c, 
     sum(CASE WHEN candSkill = jobSkill THEN 1 ELSE 0 END) AS exactMatches,
     sum(CASE WHEN candSkill <> jobSkill AND vector.similarity.cosine(candSkill.embedding, jobSkill.embedding) >= 0.85 THEN 1 ELSE 0 END) AS similarMatches,
     collect(DISTINCT candSkill.name) AS kandidatenSkills

// 4. Filtere nach deiner Bedingung: Mind. 2 exakte ODER mind. 4 ähnliche Skills
WHERE exactMatches >= 2 OR similarMatches >= 4

// 5. Erweiterte Ausgabe inklusive Jobtitel und Firma
RETURN jobTitle AS `Job Titel`,
       companyName AS `Unternehmen`,
       c.name AS `Bewerber Name`,
       exactMatches AS `Exakte Skills Anzahl`,
       similarMatches AS `Aehnliche Skills Anzahl`,
       kandidatenSkills AS `Gefundene Skills`
ORDER BY exactMatches DESC, similarMatches DESC