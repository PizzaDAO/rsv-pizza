import React, { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, GripVertical, FileText, BookOpen } from 'lucide-react';
import { Sponsor, SponsorStats, QuizQuestion, QuizStats as QuizStatsType } from '../../types';
import {
  getSponsors,
  getSponsorStats,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  updateFundraisingGoal,
  reorderSponsors,
  getQuizQuestions,
  createQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  getQuizStats,
} from '../../lib/api';
import { SponsorPipeline } from './SponsorPipeline';
import { SponsorList } from './SponsorList';
import { PartnerForm, extractSponsorData } from './PartnerForm';
import type { PartnerFormData } from './PartnerForm';
import { QuizQuestionEditor } from '../QuizQuestionEditor';

interface SponsorCRMProps {
  partyId: string;
  quizEnabled?: boolean;
}

export function SponsorCRM({ partyId, quizEnabled }: SponsorCRMProps) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [stats, setStats] = useState<SponsorStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Description reorder state
  const [descDragIndex, setDescDragIndex] = useState<number | null>(null);
  const [descOrderSponsors, setDescOrderSponsors] = useState<Sponsor[]>([]);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizStats, setQuizStats] = useState<QuizStatsType[]>([]);
  const [loadingQuiz, setLoadingQuiz] = useState(false);

  // Load sponsors and stats
  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    setError(null);

    try {
      const [sponsorsResult, statsResult] = await Promise.all([
        getSponsors(partyId),
        getSponsorStats(partyId),
      ]);

      if (sponsorsResult) {
        setSponsors(sponsorsResult.sponsors);
      }
      if (statsResult) {
        setStats(statsResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sponsors');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [partyId]);

  // Load quiz questions and stats
  const loadQuiz = useCallback(async () => {
    if (!quizEnabled) return;
    setLoadingQuiz(true);
    try {
      const [questions, statsResult] = await Promise.all([
        getQuizQuestions(partyId),
        getQuizStats(partyId),
      ]);
      setQuizQuestions(questions);
      setQuizStats(statsResult);
    } catch (err) {
      console.error('Failed to load quiz:', err);
    } finally {
      setLoadingQuiz(false);
    }
  }, [partyId, quizEnabled]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keep description-order sponsors in sync with main sponsors list
  useEffect(() => {
    setDescOrderSponsors(
      sponsors
        .filter(s => s.brandDescription && ['yes', 'billed', 'paid'].includes(s.status))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    );
  }, [sponsors]);

  useEffect(() => {
    loadQuiz();
  }, [loadQuiz]);

  // Handle form submission
  const handleFormSubmit = async (formData: PartnerFormData) => {
    const data = extractSponsorData(formData);
    setIsSubmitting(true);
    try {
      if (editingSponsor) {
        // Update existing sponsor
        const result = await updateSponsor(partyId, editingSponsor.id, data);
        if (result) {
          setSponsors(prev =>
            prev.map(s => (s.id === editingSponsor.id ? result.sponsor : s))
          );
        }
      } else {
        // Create new sponsor
        const result = await createSponsor(partyId, data);
        if (result) {
          setSponsors(prev => [result.sponsor, ...prev]);
        }
      }

      // Refresh stats
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);

      // Close form
      setShowForm(false);
      setEditingSponsor(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle sponsor deletion
  const handleDelete = async (sponsorId: string) => {
    const success = await deleteSponsor(partyId, sponsorId);
    if (success) {
      setSponsors(prev => prev.filter(s => s.id !== sponsorId));
      // Refresh stats
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);
    }
  };

  // Handle editing
  const handleEdit = (sponsor: Sponsor) => {
    setEditingSponsor(sponsor);
    setShowForm(true);
  };

  // Handle fundraising goal update
  const handleUpdateGoal = async (goal: number | null) => {
    await updateFundraisingGoal(partyId, goal);
    // Refresh stats
    const statsResult = await getSponsorStats(partyId);
    if (statsResult) setStats(statsResult);
  };

  // Quiz question handlers
  const handleAddQuizQuestion = async () => {
    try {
      const question = await createQuizQuestion(partyId, {
        question: 'New Question',
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctIndex: 0,
      });
      setQuizQuestions(prev => [...prev, question]);
    } catch (err) {
      console.error('Failed to create quiz question:', err);
    }
  };

  const handleUpdateQuizQuestion = async (questionId: string, data: any) => {
    try {
      const updated = await updateQuizQuestion(partyId, questionId, data);
      setQuizQuestions(prev => prev.map(q => q.id === questionId ? updated : q));
    } catch (err) {
      console.error('Failed to update quiz question:', err);
    }
  };

  const handleDeleteQuizQuestion = async (questionId: string) => {
    try {
      await deleteQuizQuestion(partyId, questionId);
      setQuizQuestions(prev => prev.filter(q => q.id !== questionId));
    } catch (err) {
      console.error('Failed to delete quiz question:', err);
    }
  };

  // Close form
  const handleCloseForm = () => {
    setShowForm(false);
    setEditingSponsor(null);
  };

  // Description reorder handlers
  const handleDescDragStart = (index: number) => {
    setDescDragIndex(index);
  };

  const handleDescDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (descDragIndex === null || descDragIndex === index) return;

    const newOrder = [...descOrderSponsors];
    const draggedItem = newOrder[descDragIndex];
    newOrder.splice(descDragIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setDescOrderSponsors(newOrder);
    setDescDragIndex(index);
  };

  const handleDescDragEnd = async () => {
    setDescDragIndex(null);
    try {
      await reorderSponsors(partyId, descOrderSponsors.map(s => s.id));
    } catch (err) {
      console.error('Failed to save sponsor description order:', err);
      await loadData();
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="card p-8 bg-theme-header border-theme-stroke">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-theme-text-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="card p-6 bg-theme-header border-theme-stroke">
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => loadData()}
              className="btn-secondary"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-theme-text">Partners</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          Add Partner
        </button>
      </div>

      {/* Pipeline Overview */}
      <SponsorPipeline
        stats={stats}
        onUpdateGoal={handleUpdateGoal}
        isLoading={isRefreshing}
      />

      {/* Sponsor List */}
      <SponsorList
        sponsors={sponsors}
        partyId={partyId}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onSponsorUpdate={(updated) => setSponsors(prev => prev.map(s => s.id === updated.id ? updated : s))}
        isLoading={isRefreshing}
      />

      {/* Brand Description Order */}
      {descOrderSponsors.length > 1 && (
        <div className="card bg-theme-header border-theme-stroke p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} className="text-theme-text-muted" />
            <h3 className="text-sm font-semibold text-theme-text">Brand Description Order</h3>
            <span className="text-xs text-theme-text-faint">(drag to reorder on event page)</span>
          </div>
          <div className="space-y-1.5">
            {descOrderSponsors.map((sponsor, index) => (
              <div
                key={sponsor.id}
                draggable
                onDragStart={() => handleDescDragStart(index)}
                onDragOver={(e) => handleDescDragOver(e, index)}
                onDragEnd={handleDescDragEnd}
                className={`flex items-center gap-2 p-2 rounded-lg bg-theme-surface border border-theme-stroke cursor-move transition-opacity ${
                  descDragIndex === index ? 'opacity-50' : 'opacity-100'
                }`}
              >
                <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 shrink-0">
                  <GripVertical size={16} />
                </div>
                {sponsor.logoUrl && (
                  <img src={sponsor.logoUrl} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                )}
                <span className="text-sm text-theme-text font-medium truncate">{sponsor.name}</span>
                <span className="text-xs text-theme-text-faint truncate ml-auto max-w-[50%]">
                  {sponsor.brandDescription?.substring(0, 60)}...
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quiz Questions Section */}
      {quizEnabled && (
        <div className="card p-4 bg-theme-header border-theme-stroke">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-theme-text-muted" />
              <h3 className="text-sm font-semibold text-theme-text">
                Quiz Questions ({quizQuestions.length})
              </h3>
            </div>
            <button
              onClick={handleAddQuizQuestion}
              className="flex items-center gap-1.5 text-sm text-[#ff393a] hover:text-[#ff393a]/80 transition-colors"
            >
              <Plus size={14} />
              Add Question
            </button>
          </div>

          {loadingQuiz ? (
            <div className="flex items-center justify-center py-6">
              <RefreshCw size={16} className="animate-spin text-theme-text-muted" />
            </div>
          ) : quizQuestions.length === 0 ? (
            <p className="text-sm text-theme-text-faint text-center py-6">
              No quiz questions yet. Add questions or tag a partner with quiz templates.
            </p>
          ) : (
            <div className="space-y-3">
              {quizQuestions.map((q, idx) => {
                const qStats = quizStats.find(s => s.questionId === q.id);
                return (
                  <div key={q.id}>
                    <QuizQuestionEditor
                      question={q.question}
                      options={q.options}
                      correctIndex={q.correctIndex}
                      explanation={q.explanation}
                      isFromTemplate={!!q.templateId}
                      sponsorName={q.sponsor?.name}
                      sponsorId={q.sponsorId}
                      sponsors={sponsors.filter(s => ['yes', 'billed', 'paid'].includes(s.status))}
                      onUpdate={(data) => handleUpdateQuizQuestion(q.id, data)}
                      onDelete={() => handleDeleteQuizQuestion(q.id)}
                      isFirst={idx === 0}
                      isLast={idx === quizQuestions.length - 1}
                    />
                    {qStats && qStats.totalAnswers > 0 && (
                      <div className="flex items-center gap-3 mt-1 ml-1">
                        <span className="text-[10px] text-theme-text-faint">
                          {qStats.totalAnswers} answer{qStats.totalAnswers !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-theme-text-faint">
                          {qStats.correctPercentage}% correct
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <PartnerForm
          sponsor={editingSponsor}
          partyId={partyId}
          onSponsorUpdate={(updated) => setSponsors(prev => prev.map(s => s.id === updated.id ? updated : s))}
          onSubmit={handleFormSubmit}
          onClose={handleCloseForm}
          isLoading={isSubmitting}
        />
      )}
    </div>
  );
}
