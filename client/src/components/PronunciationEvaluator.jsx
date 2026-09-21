import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Award, AlertCircle, Sparkles, CheckCircle2, RotateCcw,
  Volume2, Headphones, Play, Pause, HelpCircle, ShieldAlert, Check, ChevronDown, ChevronUp
} from 'lucide-react';
import { 
  PronunciationRecorder, 
  evaluatePronunciation, 
  compareSpeechWithReferenceAudio,
  requestMicrophoneAccess, 
  checkMicrophonePermission 
} from '../utils/speechScore';
import { api } from '../api/client';
import { playFeedbackSound, playWordAudio } from '../utils/audio';

export default function PronunciationEvaluator({ word, accent = 'us', onScored }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [evalResult, setEvalResult] = useState(null); // { score, level, feedback, recognized, userAudioUrl, selfRated }
  const [errorInfo, setErrorInfo] = useState(null); // { type, message }
  const [micPermission, setMicPermission] = useState('unknown'); // 'granted', 'prompt', 'denied', 'unknown'
  const [showPermGuide, setShowPermGuide] = useState(false);
  const [isPlayingUser, setIsPlayingUser] = useState(false);
  const [isPlayingModel, setIsPlayingModel] = useState(false);

  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const userAudioRef = useRef(null);

  // Check microphone permission on mount
  useEffect(() => {
    checkMicrophonePermission().then(status => {
      setMicPermission(status);
    });
  }, []);

  // Reset state when word changes
  useEffect(() => {
    setEvalResult(null);
    setErrorInfo(null);
    setIsRecording(false);
    setRecordSeconds(0);
    setIsPlayingUser(false);
    setIsPlayingModel(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (userAudioRef.current) {
      userAudioRef.current.pause();
      userAudioRef.current = null;
    }

    if (recorderRef.current) {
      recorderRef.current.stop();
    }
    recorderRef.current = new PronunciationRecorder({ accent });

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (userAudioRef.current) {
        userAudioRef.current.pause();
      }
      if (recorderRef.current) {
        recorderRef.current.stop();
      }
    };
  }, [word, accent]);

  // Handle explicit permission test / request
  const handleRequestPermission = async () => {
    setErrorInfo(null);
    const result = await requestMicrophoneAccess();
    if (result.ok) {
      setMicPermission('granted');
      setShowPermGuide(false);
    } else {
      setMicPermission('denied');
      setErrorInfo({
        type: result.errorType || 'not-allowed',
        message: result.message
      });
      setShowPermGuide(true);
    }
  };

  // Start recording
  const startRecording = async () => {
    setErrorInfo(null);
    setEvalResult(null);
    setIsPlayingUser(false);
    setIsPlayingModel(false);

    if (userAudioRef.current) {
      userAudioRef.current.pause();
      userAudioRef.current = null;
    }

    if (!recorderRef.current) {
      recorderRef.current = new PronunciationRecorder({ accent });
    }

    setIsRecording(true);
    setRecordSeconds(0);

    // Live timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRecordSeconds(prev => {
        if (prev >= 5) {
          stopRecording();
          return 5;
        }
        return prev + 1;
      });
    }, 1000);

    recorderRef.current.start(
      async (data) => {
        // onComplete ({ transcript, confidence, audioUrl, audioBlob, recognitionError })
        setIsRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const { transcript, confidence, audioUrl, audioBlob, recognitionError } = data;

        // If no audio recorded or too small (< 1000 bytes)
        if (!audioBlob || audioBlob.size < 1000) {
          setEvalResult({
            score: 0,
            level: 'none',
            feedback: '未能采集到有效录音，请靠近麦克风清晰大声朗读。',
            userAudioUrl: null,
            selfRated: false,
            recognitionError,
            isSilent: true
          });
          return;
        }

        // 1. If speech recognition returned real transcribed text (e.g. Edge or Chrome with recognition)
        if (transcript && transcript.trim()) {
          const result = evaluatePronunciation(word.word, transcript, confidence);
          setEvalResult({
            ...result,
            userAudioUrl: audioUrl,
            selfRated: false,
            needsSelfRating: false,
            recognitionError
          });

          playFeedbackSound(result.score >= 75);

          if (word.id) {
            api.recordResult({
              word_id: word.id,
              mode: 'memory',
              score: result.score,
              user_input: transcript,
              is_correct: result.score >= 60 ? 1 : 0,
            }).catch(console.warn);
          }

          onScored?.(result.score);
        } else {
          // 2. Direct Audio-to-Audio Acoustic Comparison (真正的原声声学特征对比 MFCC + DTW)
          // Directly compare user's voice spectrogram & formants against standard dictionary audio!
          try {
            const comparison = await compareSpeechWithReferenceAudio(audioBlob, word.word, accent);
            if (comparison && comparison.score !== null) {
              setEvalResult({
                ...comparison,
                userAudioUrl: audioUrl,
                selfRated: false,
                needsSelfRating: false,
                recognitionError
              });

              playFeedbackSound(comparison.score >= 60);

              if (word.id) {
                api.recordResult({
                  word_id: word.id,
                  mode: 'memory',
                  score: comparison.score,
                  user_input: '[声学原音对比]',
                  is_correct: comparison.score >= 60 ? 1 : 0,
                }).catch(console.warn);
              }

              onScored?.(comparison.score);
              return;
            }
          } catch (e) {
            console.warn('Audio comparison error:', e);
          }

          // Fallback if reference audio could not be fetched
          setEvalResult({
            score: null,
            needsSelfRating: true,
            userAudioUrl: audioUrl,
            selfRated: false,
            recognitionError: recognitionError || 'no_speech_engine',
            feedback: '录音已完成！请听上方原音对比，并为您本次发音打分：'
          });
        }
      },
      (err) => {
        // onError
        setIsRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        setErrorInfo({
          type: err.errorType || 'error',
          message: err.message
        });

        if (err.errorType === 'not-allowed' || err.errorType === 'insecure_origin') {
          setShowPermGuide(true);
        }
      }
    );
  };

  // Stop recording
  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && isRecording) {
      recorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Play standard model audio
  const handlePlayModelAudio = () => {
    if (isPlayingUser && userAudioRef.current) {
      userAudioRef.current.pause();
      setIsPlayingUser(false);
    }
    setIsPlayingModel(true);
    playWordAudio(word.word, accent === 'uk' ? '1' : '2');
    setTimeout(() => setIsPlayingModel(false), 1500);
  };

  // Play user's recorded audio
  const handlePlayUserAudio = () => {
    if (!evalResult?.userAudioUrl) return;

    if (isPlayingUser && userAudioRef.current) {
      userAudioRef.current.pause();
      setIsPlayingUser(false);
      return;
    }

    if (!userAudioRef.current) {
      userAudioRef.current = new Audio(evalResult.userAudioUrl);
      userAudioRef.current.onended = () => setIsPlayingUser(false);
      userAudioRef.current.onerror = () => setIsPlayingUser(false);
    }

    setIsPlayingUser(true);
    userAudioRef.current.currentTime = 0;
    userAudioRef.current.play().catch(e => {
      console.warn('Play user audio error:', e);
      setIsPlayingUser(false);
    });
  };

  // Handle self-rating when automatic speech-to-text is unavailable
  const handleSelfRate = (score) => {
    if (!evalResult) return;
    setEvalResult(prev => ({
      ...prev,
      score,
      selfRated: true,
      level: score >= 90 ? 'perfect' : score >= 75 ? 'great' : 'fair',
      feedback: score >= 90 ? '自信满分！发音地道，继续保持！' : score >= 75 ? '跟读表现很棒，多听几遍原音会更自然！' : '加油练习，熟能生巧！'
    }));

    playFeedbackSound(score >= 75);

    if (word.id) {
      api.recordResult({
        word_id: word.id,
        mode: 'memory',
        score,
        user_input: '[跟读自评]',
        is_correct: score >= 60 ? 1 : 0,
      }).catch(console.warn);
    }

    onScored?.(score);
  };

  return (
    <div className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-4 sm:p-5 mt-4 text-center shadow-2xs transition-all">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🎙️</span>
          <span>录音跟读比对与打分</span>
        </div>

        <div className="flex items-center gap-2">
          {evalResult && evalResult.score !== null && (
            <span className="text-indigo-600 font-extrabold text-sm sm:text-base">
              评分: {evalResult.score} 分
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowPermGuide(!showPermGuide)}
            className="text-[11px] font-medium text-slate-400 hover:text-indigo-600 inline-flex items-center gap-0.5 transition-colors"
            title="查看麦克风权限与设置指引"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>设置指引</span>
          </button>
        </div>
      </div>

      {/* Permission Guide Accordion / Alert */}
      {(showPermGuide || errorInfo) && (
        <div className="mb-4 text-left p-3 sm:p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl text-xs space-y-2 animate-fade-in shadow-2xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>麦克风授权与使用提示</span>
            </div>
            <button
              type="button"
              onClick={() => setShowPermGuide(false)}
              className="text-amber-700 hover:text-amber-900 p-0.5 rounded"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>

          {errorInfo && (
            <div className="font-semibold text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-100 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorInfo.message}</span>
            </div>
          )}

          <div className="text-slate-600 space-y-1.5 leading-relaxed">
            <p><strong>💡 如何解决麦克风未授权或识别错误：</strong></p>
            <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-slate-700">
              <li><strong>步骤 1：</strong>点击浏览器上方网址左侧的 <strong>🔒 锁头</strong>（或设置图标），将「麦克风」从“禁止”修改为<strong>“允许”</strong>。</li>
              <li><strong>步骤 2 (强烈推荐 Edge 浏览器)：</strong>如果当前在 Chrome 浏览器中提示识别错误，因 Chrome 语音识别依赖 Google 海外服务器；推荐使用 Windows 自带的 <strong>Edge 浏览器</strong>打开本站（内置微软原生语音识别引擎，国内免翻墙直接可用且准确度极高）。</li>
              <li><strong>步骤 3：</strong>确保 Windows 系统设置已开启麦克风权限（「设置」→「隐私和安全性」→「麦克风」）。</li>
            </ul>
          </div>

          <div className="pt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={handleRequestPermission}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>立即申请麦克风权限</span>
            </button>
            <span className="text-[11px] text-amber-800">
              点击后请在浏览器弹出的窗口中选择【允许】
            </span>
          </div>
        </div>
      )}

      {/* Main Record Action Button */}
      <div className="flex flex-col items-center justify-center gap-2.5 my-2">
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all transform active:scale-95 shadow-md cursor-pointer ${
            isRecording
              ? 'bg-rose-600 text-white animate-pulse shadow-rose-300 ring-4 ring-rose-200'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 hover:scale-105'
          }`}
          title={isRecording ? '点击结束录音' : '点击开始朗读该单词'}
        >
          {isRecording ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
        </button>

        <div className="flex flex-col items-center">
          <span className="text-xs sm:text-sm font-semibold text-slate-700">
            {isRecording ? (
              <span className="text-rose-600 font-bold flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-600 animate-ping" />
                正在倾听，请清晰朗读... ({recordSeconds}s / 5s)
              </span>
            ) : (
              '点击麦克风，跟读该单词'
            )}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5">
            {isRecording ? '朗读完毕后可再次点击停止，或等待 5 秒自动结束' : '支持录音回放对比与智能语音打分'}
          </span>
        </div>
      </div>

      {/* Dual-Track Audio Player (Standard Model Voice vs User Recording) */}
      {evalResult?.userAudioUrl && (
        <div className="mt-4 p-3 bg-white border border-slate-200 rounded-xl flex flex-wrap items-center justify-center gap-2 sm:gap-4 shadow-2xs animate-fade-in">
          <button
            type="button"
            onClick={handlePlayUserAudio}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
              isPlayingUser
                ? 'bg-indigo-600 text-white animate-pulse'
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}
            title="播放刚才录下的自己发音"
          >
            {isPlayingUser ? <Pause className="w-3.5 h-3.5" /> : <Headphones className="w-3.5 h-3.5" />}
            <span>{isPlayingUser ? '暂停播放' : '🎧 播放我的发音'}</span>
          </button>

          <button
            type="button"
            onClick={handlePlayModelAudio}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
              isPlayingModel
                ? 'bg-slate-800 text-white animate-pulse'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
            }`}
            title="播放标准词典发音"
          >
            <Volume2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>🔊 听标准原音对比</span>
          </button>
        </div>
      )}

      {/* Evaluation Results Card */}
      {evalResult && (
        <div className="mt-4 p-3.5 bg-white border border-slate-200 rounded-xl text-left space-y-2.5 animate-fade-in shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {evalResult.score !== null && evalResult.score > 0 ? (
                <>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                    evalResult.score >= 85 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                      : evalResult.score >= 60 
                      ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                      : 'bg-rose-100 text-rose-800 border border-rose-200'
                  }`}>
                    {evalResult.score >= 85 ? '🌟 地道纯正' : evalResult.score >= 60 ? '👍 表现不错' : '💪 仍需练习'}
                  </span>
                  <span className="text-xs text-slate-400">得分:</span>
                  <span className="font-black text-slate-800 text-base">{evalResult.score} / 100</span>
                  {evalResult.isAcousticComparison && (
                    <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded font-bold">
                      🎯 原声声学比对
                    </span>
                  )}
                </>
              ) : evalResult.score === 0 ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                  ⚠️ 未检测到有效发音
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200">
                  🎧 录音完成 · 请听原音自评
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={startRecording}
              className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重新录音</span>
            </button>
          </div>

          {/* Target & Recognition detail */}
          <div className="text-xs text-slate-600 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500">跟读目标:</span>
              <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                {word.word}
              </span>
              {word.phonetic && (
                <span className="text-slate-400 font-mono text-[11px]">{word.phonetic}</span>
              )}
              {evalResult.recognized && evalResult.recognized.toLowerCase() !== word.word.toLowerCase() && (
                <span className="text-rose-600 font-semibold text-[11px] bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
                  识别为: <span className="font-mono font-bold">"{evalResult.recognized}"</span>
                </span>
              )}
            </div>

            {/* Quick score adjustment buttons (only if scored) */}
            {evalResult.score !== null && evalResult.score > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="text-slate-400">微调:</span>
                <button
                  type="button"
                  onClick={() => handleSelfRate(95)}
                  className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded font-bold transition-colors cursor-pointer"
                  title="调整评分为 95分"
                >
                  95分
                </button>
                <button
                  type="button"
                  onClick={() => handleSelfRate(80)}
                  className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded font-bold transition-colors cursor-pointer"
                  title="调整评分为 80分"
                >
                  80分
                </button>
                <button
                  type="button"
                  onClick={() => handleSelfRate(50)}
                  className="px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-bold transition-colors cursor-pointer"
                  title="调整评分为 50分"
                >
                  50分
                </button>
              </div>
            )}
          </div>

          {/* Self-rating action card if speech-to-text was unavailable */}
          {evalResult.needsSelfRating && evalResult.score === null && (
            <div className="p-3 bg-indigo-50/70 border border-indigo-200/90 rounded-xl space-y-2.5 animate-fade-in">
              <div className="text-xs font-bold text-indigo-900 flex items-center justify-between">
                <span>⭐ 请点击上方播放听原音对比，并为您本次发音打分：</span>
              </div>
              <div className="flex items-center justify-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => handleSelfRate(95)}
                  className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                >
                  <span>🌟 地道纯正 (95分)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelfRate(80)}
                  className="flex-1 py-1.5 px-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                >
                  <span>👍 表现不错 (80分)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelfRate(50)}
                  className="flex-1 py-1.5 px-2 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                >
                  <span>💪 读错了 (50分)</span>
                </button>
              </div>
              <div className="text-[11px] text-slate-600 bg-white/80 p-2 rounded-lg border border-indigo-100 leading-relaxed text-left">
                <span>💡 <strong>为什么需要自评？</strong>当前 Chrome 浏览器未在大陆开放谷歌语音识别，因此无法全自动将语音转为文字比对。</span>
                <br />
                <span className="text-indigo-700 font-semibold">👉 强烈推荐使用 Windows 自带的 Edge 浏览器打开本站：内置微软原生语音识别，即读即判，读对打高分、读错立刻扣分！</span>
              </div>
            </div>
          )}

          <div className={`text-xs font-medium p-2.5 rounded-lg border flex items-center gap-1.5 ${
            evalResult.score !== null && evalResult.score >= 60 
              ? 'text-slate-600 bg-slate-50 border-slate-100' 
              : evalResult.score !== null && evalResult.score > 0
              ? 'text-rose-700 bg-rose-50 border-rose-100'
              : 'text-amber-800 bg-amber-50 border-amber-200'
          }`}>
            <span className="shrink-0">{evalResult.score !== null && evalResult.score >= 60 ? '💡' : '⚠️'}</span>
            <span className="leading-relaxed">{evalResult.feedback}</span>
          </div>
        </div>
      )}
    </div>
  );
}
