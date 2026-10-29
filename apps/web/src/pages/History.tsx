import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { api, displayDate } from '../lib/api';
import type { HistoryCase } from '../lib/types';
import { ErrorState, Loading } from '../components/Common';
import Modal from '../components/Modal';
export default function History() {
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const cache = useQueryClient();
  const history = useQuery({
    queryKey: ['history', page],
    queryFn: () =>
      api<{ cases: HistoryCase[]; page: number; hasMore: boolean }>(`/cases?page=${page}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/cases/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteId(null);
      void cache.invalidateQueries({ queryKey: ['history'] });
    },
  });
  return (
    <main id="main" className="page-width history-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR PRIVATE ARCHIVE</p>
          <h1>
            Case <span>files.</span>
          </h1>
          <p>Unfinished business. Solved mysteries. Every trail you followed.</p>
        </div>
        <Link className="button primary" to="/create">
          <Plus size={17} />
          New mystery
        </Link>
      </div>
      <p className="retention-note">
        <Clock3 size={15} />
        Cases are kept for 30 days in this browser's guest session.
      </p>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorState error={history.error} retry={() => void history.refetch()} />
      ) : history.data.cases.length === 0 ? (
        <div className="empty-state panel">
          <FolderOpen size={42} strokeWidth={1} />
          <h2>The archive is quiet.</h2>
          <p>Your first mystery is waiting to be written.</p>
          <Link className="button primary" to="/create">
            Open your first case <ArrowRight size={17} />
          </Link>
        </div>
      ) : (
        <>
          <div className="history-list">
            {history.data.cases.map((item) => {
              const id = item.id || item.caseId!;
              const submitted = item.submitted || item.isSubmitted || item.status === 'SUBMITTED';
              const target = submitted
                ? 'result'
                : item.status === 'READY'
                  ? 'investigate'
                  : 'preparing';
              return (
                <article className="history-card panel" key={id}>
                  <div className="history-icon">
                    <FolderOpen size={25} />
                  </div>
                  <div className="history-card-body">
                    <div className="history-meta">
                      <span>{displayDate(item.createdAt)}</span>
                      <span>{item.difficulty}</span>
                    </div>
                    <h2>{item.title || 'An untitled investigation'}</h2>
                    <span
                      className={`case-status ${item.status === 'FAILED' ? 'failed' : submitted ? 'solved' : ''}`}
                    >
                      {submitted
                        ? 'CLOSED'
                        : item.status === 'READY'
                          ? 'READY TO INVESTIGATE'
                          : item.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="history-actions">
                    <Link className="button small" to={`/cases/${id}/${target}`}>
                      {submitted
                        ? 'View verdict'
                        : item.status === 'READY'
                          ? 'Resume case'
                          : 'View progress'}
                      <ArrowRight size={15} />
                    </Link>
                    <button
                      className="icon-button danger"
                      aria-label={`Delete ${item.title || 'case'}`}
                      onClick={() => setDeleteId(id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="pagination">
            <button
              className="button small"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="button small"
              disabled={!history.data.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {deleteId && (
        <Modal
          title="Delete this case?"
          onClose={() => {
            if (!remove.isPending) setDeleteId(null);
          }}
        >
          <p className="eyebrow">CLOSE THIS FILE</p>
          <p>
            Your access will end immediately. The case and its media will be permanently removed.
          </p>
          {remove.isError && <ErrorState error={remove.error} />}
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => setDeleteId(null)}
              disabled={remove.isPending}
            >
              Keep case
            </button>
            <button
              className="button danger-button"
              onClick={() => remove.mutate(deleteId)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Deleting…' : 'Delete case'}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
