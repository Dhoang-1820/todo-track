// Public (publishable) Supabase settings. Row Level Security limits this key to
// reading questions and adding/reading your own test attempts.
window.APP_CONFIG = {
  supabaseUrl: "https://yubwbtmvhegptbheonsb.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1YndidG12aGVncHRiaGVvbnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MTU2OTUsImV4cCI6MjExMDM5MTY5NX0.VivLg8MHnol_WxyfAyZ1P5Cmrr4WHcXm7R8Ejqx0-7U",
  passScore: 700,          // Microsoft's passing score on the 1-1000 scale
  mockMinutes: 120,        // time limit for a full mock test
  questionsPerMock: 40
};
