# Backup e recuperação

## Estratégia inicial

- backup diário do banco PostgreSQL;
- retenção semanal;
- cópia externa em ambiente separado;
- restauração testada em ambiente de homologação.

## Comandos sugeridos

```bash
pg_dump -U teledis -d teledis > backup_teledis.sql
```

## Recuperação

```bash
psql -U teledis -d teledis < backup_teledis.sql
```

## Boas práticas

- realizar validação do conteúdo do backup;
- manter cópias fora do servidor principal;
- definir retenção e política de armazenamento.
