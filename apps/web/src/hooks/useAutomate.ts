import { useState, useEffect } from 'react';
import {
  defaultApiClient,
  type Conversation,
  type Message,
  type Connector,
  type VaultSecret,
} from '../lib/api.js';
import type { ApiClient } from '../lib/api.js';

export function useConversations(api: ApiClient = defaultApiClient) {
  const [data, setData] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        const res = await api.getConversations();
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [api]);

  return { data, isLoading, error };
}

export function useConversation(id: string, api: ApiClient = defaultApiClient) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        const res = await api.getMessages(id);
        if (mounted) {
          setMessages(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [id, api]);

  return { messages, isLoading, error };
}

export function useConnectors(api: ApiClient = defaultApiClient) {
  const [data, setData] = useState<Connector[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        const res = await api.getConnectors();
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [api]);

  return { data, isLoading, error };
}

export function useVault(api: ApiClient = defaultApiClient) {
  const [data, setData] = useState<VaultSecret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const deleteSecret = async (id: string) => {
    await api.deleteVaultSecret(id);
    setData(prev => prev.filter(s => s.id !== id));
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        const res = await api.getVaultSecrets();
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [api]);

  return { data, isLoading, error, deleteSecret };
}
