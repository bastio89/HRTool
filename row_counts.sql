DROP TABLE IF EXISTS pg_temp.row_counts;

CREATE TEMP TABLE row_counts (
    schema_name text NOT NULL,
    table_name text NOT NULL,
    row_count bigint NOT NULL
);

DO $$
DECLARE
    current_table record;
BEGIN
    FOR current_table IN
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema <> 'information_schema'
          AND table_schema !~ '^pg_'
    LOOP
        EXECUTE format(
            'INSERT INTO pg_temp.row_counts SELECT %L, %L, count(*) FROM %I.%I',
            current_table.table_schema,
            current_table.table_name,
            current_table.table_schema,
            current_table.table_name
        );
    END LOOP;
END;
$$;

SELECT schema_name, table_name, row_count
FROM pg_temp.row_counts
ORDER BY row_count DESC, schema_name, table_name;