import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Film, ImagePlus, Music2, UploadCloud, X } from "lucide-react";
import { formatBytes, uploadLimitBytes } from "../lib/media";

type MediaType = "image" | "audio" | "video";

interface MediaUploadProps {
  type: MediaType;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  maxUploadMb?: number;
  maxUploadBytes?: number;
}

const FORMATS: Record<
  MediaType,
  { extensions: string[]; mimeTypes: string[]; label: string }
> = {
  image: {
    extensions: ["jpg", "jpeg", "png", "webp", "gif"],
    mimeTypes: [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
    ],
    label: "JPG, PNG, WebP or GIF",
  },
  audio: {
    extensions: ["mp3", "wav", "m4a", "ogg", "webm", "flac"],
    mimeTypes: [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
      "audio/vnd.wave",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a",
      "audio/ogg",
      "application/ogg",
      "audio/webm",
      "audio/flac",
      "audio/x-flac",
    ],
    label: "MP3, WAV, M4A, OGG, WebM or FLAC",
  },
  video: {
    extensions: ["mp4", "webm", "mov"],
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    label: "MP4, WebM or MOV",
  },
};

export default function MediaUpload({
  type,
  file,
  onChange,
  disabled = false,
  maxUploadMb = 50,
  maxUploadBytes,
}: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const formats = FORMATS[type];
  const maxBytes = uploadLimitBytes(maxUploadMb, maxUploadBytes);
  const limitLabel = `${Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 50} MB`;
  const Icon = type === "image" ? ImagePlus : type === "audio" ? Music2 : Film;

  useEffect(() => {
    setError("");
    setPreviewError(false);
    setDragging(false);
    dragDepth.current = 0;
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, type]);

  useEffect(() => {
    if (file && file.size > maxBytes)
      setError(
        `This file is ${formatBytes(file.size)}. Choose a file up to ${limitLabel}.`,
      );
  }, [file, maxBytes, limitLabel]);

  function selectFile(files: FileList | null) {
    if (disabled || !files?.length) return;
    if (files.length > 1) {
      setError(
        "Choose one file at a time so each piece of content gets its own analysis.",
      );
      return;
    }
    const candidate = files[0];
    const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = candidate.type.toLowerCase().split(";")[0].trim();
    const genericMime =
      !mime ||
      ["application/octet-stream", "binary/octet-stream"].includes(mime);
    // Some browsers identify an audio-only WebM container as video/webm.
    const audioWebm =
      type === "audio" && extension === "webm" && mime === "video/webm";
    const validType =
      formats.mimeTypes.includes(mime) ||
      (formats.extensions.includes(extension) && (genericMime || audioWebm));
    if (!validType) {
      setError(`Please choose a supported ${type} file: ${formats.label}.`);
      return;
    }
    if (!candidate.size) {
      setError("This file is empty. Choose a file that contains your content.");
      return;
    }
    if (candidate.size > maxBytes) {
      setError(
        `This file is ${formatBytes(candidate.size)}. Choose a file up to ${limitLabel}.`,
      );
      return;
    }
    setError("");
    onChange(candidate);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.currentTarget.files);
    // Let the same file be selected again after removal or a validation failure.
    event.currentTarget.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    selectFile(event.dataTransfer.files);
  }

  return (
    <div className="media-upload">
      <div
        className={`media-dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
        data-disabled={disabled || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled && event.dataTransfer.types.includes("Files")) {
            dragDepth.current += 1;
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="file"
          accept={[
            ...formats.mimeTypes,
            ...formats.extensions.map((ext) => `.${ext}`),
          ].join(",")}
          onChange={handleInput}
          aria-label={`Choose ${type} file`}
          aria-describedby={`${id}-caption${error ? ` ${id}-error` : ""}`}
          disabled={disabled}
          hidden
        />
        {file ? (
          <>
            {previewUrl && !previewError && (
              <div className={`media-preview media-preview-${type}`}>
                {type === "image" && (
                  <img
                    src={previewUrl}
                    alt={`Preview of ${file.name}`}
                    onError={() => setPreviewError(true)}
                  />
                )}
                {type === "audio" && (
                  <audio
                    src={previewUrl}
                    controls
                    preload="metadata"
                    aria-label={`Preview of ${file.name}`}
                    onError={() => setPreviewError(true)}
                  />
                )}
                {type === "video" && (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={`Preview of ${file.name}`}
                    onError={() => setPreviewError(true)}
                  />
                )}
              </div>
            )}
            {previewError && (
              <p className="upload-caption">
                Your browser cannot preview this format. You can still submit it
                for analysis.
              </p>
            )}
            <div className="media-file-info">
              <Icon size={20} aria-hidden="true" />
              <div>
                <strong title={file.name}>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </div>
              <button
                className="media-remove"
                type="button"
                aria-label={`Remove ${file.name}`}
                title="Remove file"
                disabled={disabled}
                onClick={() => {
                  setError("");
                  onChange(null);
                }}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <button
              className="upload-browse"
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              Replace file
            </button>
          </>
        ) : (
          <>
            <span className="upload-icon">
              <UploadCloud size={25} aria-hidden="true" />
            </span>
            <strong>Drop your {type} here</strong>
            <span className="upload-caption">
              or{" "}
              <button
                className="upload-browse"
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
              >
                browse files
              </button>
            </span>
          </>
        )}
        <p className="upload-caption" id={`${id}-caption`}>
          {formats.label} · Up to {limitLabel}
        </p>
      </div>
      {error && (
        <p className="media-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      <p className="upload-caption">
        Uploaded to the Viralify server for processing. AI review is optional.
      </p>
    </div>
  );
}
