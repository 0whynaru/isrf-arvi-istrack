-- Jalankan ini sekali di Supabase SQL Editor (Project -> SQL Editor -> New query).

create table if not exists public.documents (
  id                 bigint generated always as identity primary key,
  title              text not null,
  original_filename  text not null,
  storage_path       text not null,
  mime_type          text not null,
  uploader_name      text not null,
  note               text,
  status             text not null default 'waiting' check (status in ('waiting', 'active', 'rejected')),
  reject_reason      text,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);

create index if not exists documents_status_idx on public.documents (status);
create index if not exists documents_created_at_idx on public.documents (created_at desc);

-- RLS diaktifkan tapi TIDAK dikasih policy apapun -> semua akses lewat
-- anon/authenticated key otomatis ditolak. Netlify Functions selalu pakai
-- SERVICE ROLE key (lihat netlify/functions/_supabase.js), yang otomatis
-- bypass RLS. Jadi satu-satunya jalan masuk ke tabel ini ya lewat
-- function-function yang sudah dibikin, bukan langsung dari browser.
alter table public.documents enable row level security;

-- Bucket storage privat buat file dokumennya. "public: false" artinya
-- file cuma bisa diakses lewat signed URL yang dibikin oleh
-- documents-download.js, bukan lewat URL publik langsung.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
