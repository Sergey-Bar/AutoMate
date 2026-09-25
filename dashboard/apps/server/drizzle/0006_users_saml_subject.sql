-- Migration: add saml_subject column to users table for SSO/SAML 2.0 identity matching
ALTER TABLE users ADD COLUMN saml_subject TEXT;
