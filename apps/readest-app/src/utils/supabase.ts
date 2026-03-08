const disabledError = () =>
  new Error('OpenReadest has disabled the original Supabase-backed account and cloud services.');

type DisabledSupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: null }; error: Error | null }>;
    setSession: () => Promise<{ data: { session: null; user: null }; error: Error }>;
    admin: {
      deleteUser: () => Promise<{ data: null; error: Error }>;
    };
  };
  from: (...args: unknown[]) => any;
  rpc: (...args: unknown[]) => any;
};

const createDisabledSupabaseClient = (): DisabledSupabaseClient => ({
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    setSession: async () => ({
      data: { session: null, user: null },
      error: disabledError(),
    }),
    admin: {
      deleteUser: async () => ({ data: null, error: disabledError() }),
    },
  },
  from: () => {
    throw disabledError();
  },
  rpc: () => {
    throw disabledError();
  },
});

export const supabase = createDisabledSupabaseClient();

export const createSupabaseClient = (_accessToken?: string) => {
  return createDisabledSupabaseClient();
};

export const createSupabaseAdminClient = () => {
  return createDisabledSupabaseClient();
};
