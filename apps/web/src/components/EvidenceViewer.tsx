import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, Check, FileText, Maximize2, Minus, Plus, ScanLine } from 'lucide-react';
import { api, displayDate, displayTime } from '../lib/api';
import type { Evidence } from '../lib/types';
import { ErrorState, FictionLabel, Loading } from './Common';
import Modal from './Modal';
export default function EvidenceViewer({
  evidence,
  caseId,
  timezone,
  reviewed,
  bookmarked,
  onReview,
  onBookmark,
  pending,
}: {
  evidence: Evidence;
  caseId: string;
  timezone: string;
  reviewed: boolean;
  bookmarked: boolean;
  onReview: () => void;
  onBookmark: () => void;
  pending: boolean;
}) {
  const [zoom, setZoom] = useState(false);
  const [scale, setScale] = useState(1);
  const [mediaFailed, setMediaFailed] = useState(false);
  const mediaAssetId =
    evidence.type === 'PHOTO' || evidence.type === 'CCTV' ? evidence.payload.assetId : undefined;
  const altText = evidence.type === 'PHOTO' ? evidence.payload.altText : evidence.description;
  const media = useQuery({
    queryKey: ['asset', caseId, mediaAssetId],
    queryFn: () =>
      api<{ url: string; mimeType: string }>(`/cases/${caseId}/assets/${mediaAssetId}/access`),
    enabled: !!mediaAssetId,
    staleTime: 240000,
    refetchInterval: 240000,
  });
  const firstSender = evidence.type === 'CHAT' ? evidence.payload.messages[0]?.sender : undefined;
  const reconstructionLabel =
    evidence.type === 'CCTV' && evidence.payload.generationMethod === 'AI_FRAME_VIDEO'
      ? 'AI-frame surveillance reconstruction'
      : 'AI-generated fictional surveillance reconstruction';
  return (
    <article className="evidence-viewer" key={evidence.id}>
      <div className="viewer-heading">
        <div className="viewer-meta">
          <span>{evidence.id}</span>
          <span>{evidence.type === 'CCTV' ? 'SURVEILLANCE' : evidence.type}</span>
          <span>{displayTime(evidence.occurredAt, timezone)}</span>
        </div>
        <h2>{evidence.title}</h2>
        <p>{evidence.source}</p>
        <FictionLabel />
      </div>
      <div className="viewer-content">
        {evidence.type === 'CHAT' && (
          <div className="chat-viewer">
            <div className="chat-heading">
              <span className="chat-avatar">{firstSender?.slice(0, 1) || 'C'}</span>
              <div>
                <strong>
                  {[...new Set(evidence.payload.messages?.map((message) => message.sender))].join(
                    ' & ',
                  )}
                </strong>
                <small>Fictional conversation</small>
              </div>
            </div>
            <div className="chat-date">{displayDate(evidence.occurredAt)}</div>
            <div className="chat-messages">
              {evidence.payload.messages?.map((message) => (
                <div
                  className={`chat-bubble ${message.sender !== firstSender ? 'outgoing' : ''}`}
                  key={message.id}
                >
                  <strong>{message.sender}</strong>
                  <p>{message.text}</p>
                  <time dateTime={message.timestamp}>
                    {displayTime(message.timestamp, timezone)}
                  </time>
                </div>
              ))}
            </div>
            <p className="media-disclosure">
              Fictional chat simulation — not an actual WhatsApp export.
            </p>
          </div>
        )}
        {(evidence.type === 'PHOTO' || evidence.type === 'CCTV') &&
          (media.isPending ? (
            <Loading label="Loading private evidence…" />
          ) : media.isError ? (
            <ErrorState error={media.error} retry={() => void media.refetch()} />
          ) : (
            media.data && (
              <>
                {evidence.type === 'PHOTO' ? (
                  <div className="photo-frame">
                    <img
                      src={media.data.url}
                      alt={altText}
                      loading="lazy"
                      onError={() => setMediaFailed(true)}
                    />
                    <button
                      className="photo-zoom button small"
                      onClick={() => {
                        setScale(1);
                        setZoom(true);
                      }}
                    >
                      <Maximize2 size={14} />
                      Inspect photo
                    </button>
                  </div>
                ) : (
                  <div className="video-frame">
                    <div className="camera-meta">
                      <ScanLine size={13} />
                      <span>{evidence.payload.cameraLabel}</span>
                      <span>
                        {evidence.payload.cameraTimestamp
                          ? displayTime(evidence.payload.cameraTimestamp, timezone)
                          : displayTime(evidence.occurredAt, timezone)}
                      </span>
                    </div>
                    <video
                      src={media.data.url}
                      controls
                      muted
                      playsInline
                      preload="metadata"
                      aria-label={evidence.title}
                      onError={() => setMediaFailed(true)}
                    >
                      Your browser does not support this video.
                    </video>
                    <p className="media-disclosure">{reconstructionLabel}</p>
                  </div>
                )}
              </>
            )
          ))}
        {mediaFailed && (
          <ErrorState
            error={
              new Error(
                'This evidence could not be loaded. Refresh its private access link and try again.',
              )
            }
            retry={() => {
              setMediaFailed(false);
              void media.refetch();
            }}
          />
        )}
        {evidence.type === 'DOCUMENT' && (
          <div className="document-viewer">
            <div className="document-letterhead">
              <FileText size={24} />
              <span>
                FICTIONAL CASE RECORD
                <br />
                <b>{evidence.payload.documentKind?.replaceAll('_', ' ')}</b>
              </span>
            </div>
            <div className="document-date">
              {evidence.source} · {displayDate(evidence.occurredAt)}
            </div>
            <div className="document-body">
              {evidence.payload.documentBody?.split('\n').map((line, index) => (
                <p key={index}>{line || '\u00a0'}</p>
              ))}
            </div>
            <div className="document-end">END OF RECORD / {evidence.id}</div>
          </div>
        )}
        <div className="evidence-observation">
          <span className="eyebrow">
            {evidence.type === 'CCTV' ? 'CAMERA TRANSCRIPT' : 'VERIFIED OBSERVATION'}
          </span>
          <p>{evidence.type === 'CCTV' ? evidence.payload.transcript : evidence.description}</p>
        </div>
      </div>
      <div className="viewer-actions">
        <button
          disabled={pending}
          className={`button small ${reviewed ? 'is-reviewed' : ''}`}
          data-testid="mark-reviewed"
          onClick={onReview}
        >
          <Check size={15} />
          {reviewed ? 'Reviewed' : 'Mark reviewed'}
        </button>
        <button
          disabled={pending}
          className={`button small ${bookmarked ? 'is-bookmarked' : ''}`}
          data-testid="bookmark-evidence"
          onClick={onBookmark}
          aria-pressed={bookmarked}
        >
          <Bookmark size={15} fill={bookmarked ? 'currentColor' : 'none'} />
          {bookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>
      </div>
      {zoom && media.data && (
        <Modal title={evidence.title} onClose={() => setZoom(false)} wide>
          <div className="zoom-controls">
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => setScale((value) => Math.max(1, value - 0.5))}
              disabled={scale <= 1}
            >
              <Minus size={18} />
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => setScale((value) => Math.min(4, value + 0.5))}
              disabled={scale >= 4}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="zoom-scroll">
            <img
              src={media.data.url}
              alt={altText}
              style={{ width: `${scale * 100}%`, maxWidth: 'none' }}
            />
          </div>
          <p className="zoom-caption">{evidence.description}</p>
        </Modal>
      )}
    </article>
  );
}
