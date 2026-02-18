'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import {
  MAX_FILES,
  MAX_FILE_SIZE_MB,
  ACCEPTED_TYPES,
} from '@/types';

interface UploadZoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

export function UploadZone({ files, onChange, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (incoming: File[]): { valid: File[]; errors: string[] } => {
    const errors: string[] = [];
    const valid: File[] = [];

    for (const file of incoming) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: unsupported format`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: exceeds ${MAX_FILE_SIZE_MB} MB`);
        continue;
      }
      valid.push(file);
    }

    return { valid, errors };
  };

  const addFiles = useCallback(
    (incoming: File[]) => {
      const { valid, errors } = validate(incoming);
      if (errors.length) {
        setError(errors.join(' · '));
        return;
      }
      setError(null);

      const merged = [...files, ...valid];
      if (merged.length > MAX_FILES) {
        setError(`Maximum ${MAX_FILES} images per batch.`);
        onChange(merged.slice(0, MAX_FILES));
        return;
      }
      onChange(merged);
    },
    [files, onChange]
  );

  const removeFile = (index: number) => {
    const next = files.filter((_, i) => i !== index);
    onChange(next);
    if (error) setError(null);
  };

  // ── Drag handlers ──────────────────────────────────────────

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    // Reset input so the same file can be added again after removal
    e.target.value = '';
  };

  const remaining = MAX_FILES - files.length;

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        className={[
          'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed',
          'transition-all duration-200 cursor-pointer select-none',
          'min-h-[200px] px-6 py-10',
          disabled
            ? 'border-neutral-700 bg-neutral-900 cursor-not-allowed opacity-50'
            : isDragging
            ? 'border-amber-400 bg-amber-400/10 scale-[1.01]'
            : files.length > 0
            ? 'border-neutral-600 bg-neutral-900/80'
            : 'border-neutral-700 bg-neutral-900 hover:border-amber-500 hover:bg-amber-500/5',
        ].join(' ')}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        aria-label="Upload food photos"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          className="sr-only"
          onChange={onInputChange}
          disabled={disabled}
        />

        {files.length === 0 ? (
          <>
            {/* Upload Icon */}
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20">
              <svg className="h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-base font-medium text-neutral-200">
              Drop your food photos here
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              or <span className="text-amber-400 hover:text-amber-300">browse files</span>
            </p>
            <p className="mt-3 text-xs text-neutral-600">
              Up to {MAX_FILES} images · JPG, PNG, WebP, HEIC · Max {MAX_FILE_SIZE_MB} MB each
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-300">
              {files.length} {files.length === 1 ? 'image' : 'images'} selected
            </p>
            {remaining > 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                <span className="text-amber-400">+ Add more</span> · {remaining} remaining
              </p>
            )}
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Preview Grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {files.map((file, i) => (
            <FilePreviewTile key={`${file.name}-${i}`} file={file} onRemove={() => removeFile(i)} />
          ))}
          {/* Add more tile */}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="relative aspect-square rounded-xl border-2 border-dashed border-neutral-700
                         flex flex-col items-center justify-center gap-1
                         hover:border-amber-500 hover:bg-amber-500/5 transition-colors"
            >
              <svg className="h-5 w-5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-[10px] text-neutral-600">Add</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Preview tile ───────────────────────────────────────────────

function FilePreviewTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null);

  // Generate object URL lazily
  if (!src) {
    const url = URL.createObjectURL(file);
    setSrc(url);
  }

  return (
    <div className="group relative aspect-square">
      {src && (
        <Image
          src={src}
          alt={file.name}
          fill
          className="rounded-xl object-cover"
          sizes="100px"
          unoptimized
        />
      )}
      {/* Remove button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center
                   rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400
                   opacity-0 group-hover:opacity-100 transition-opacity hover:text-white hover:bg-red-600"
        aria-label={`Remove ${file.name}`}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* File name tooltip */}
      <div className="absolute inset-x-0 bottom-0 rounded-b-xl bg-black/60 px-1 py-0.5
                      opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="truncate text-[9px] text-white">{file.name}</p>
      </div>
    </div>
  );
}
