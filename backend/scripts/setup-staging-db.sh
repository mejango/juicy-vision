#!/bin/bash
# Setup local staging database
# Run this script to create a separate PostgreSQL database for staging/testnet development

set -e

DB_NAME="juicyvision_staging"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"

echo "Setting up staging database: $DB_NAME"

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "Error: psql command not found. Please install PostgreSQL."
    exit 1
fi

# Create database if it doesn't exist
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "CREATE DATABASE $DB_NAME"

echo "Database '$DB_NAME' is ready."
echo ""
echo "Connection string for .env.staging:"
echo "DATABASE_URL=postgresql://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""
echo "To run migrations on staging database:"
echo "  DATABASE_URL=postgresql://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME deno task migrate"
