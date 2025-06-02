import React from 'react';
import styles from './MessageCard.module.css';

// Sesuaikan path atau definisikan SpeakerIcon di sini jika belum
const SpeakerIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
        <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.348 2.595.341 1.24 1.518 1.905 2.66 1.905H6.44l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 12.353a.75.75 0 0 0 0-1.06l-2.121-2.122a.75.75 0 0 0-1.061 1.061L16.563 11H15a.75.75 0 0 0 0 1.5h1.563l-1.16 1.16a.75.75 0 1 0 1.06 1.061l2.122-2.121Z" />
        {/* Path kedua di SpeakerIcon sebelumnya ada potensi overlap, sederhanakan atau gunakan path yang sudah ada */}
         <path d="M19.5 12c0 2.47-1.164 4.683-3 6.066a.75.75 0 1 1-.916-1.373A6.75 6.75 0 0 0 18 12a6.75 6.75 0 0 0-2.416-5.066a.75.75 0 1 1 .916-1.373A8.25 8.25 0 0 1 19.5 12Z" />

    </svg>
);


type MessageCardProps = {
    role: "assistant" | "user";
    message: string;
    timestamp: string;
    onPlaySound?: (textOrAudioData: string | any) => void;
    audioData?: any; 
    provider?: string; // Tambahkan provider di props
};

export const MessageCard = (props: MessageCardProps) => {
    const isUser = props.role === "user";

    const handlePlaySound = () => {
        if (props.onPlaySound) {
            if (props.audioData) {
                props.onPlaySound(props.audioData);
            } else if (!isUser && props.message) { 
                props.onPlaySound(props.message);
            }
        }
    };

    return (
        <div className={`${styles.messageWrapper} ${isUser ? styles.user : styles.assistant}`}>
            {!isUser && (
                <div className={`${styles.avatar} ${styles.avatarAssistant}`}>A</div>
            )}
            <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}>
                <p className={styles.messageText}>{props.message}</p>
                <div className={styles.messageInfo}>
                    <div className={styles.metaContainer}>
                        <p className={`${styles.timestamp} ${isUser ? styles.timestampUser : styles.timestampAssistant}`}>
                            {props.timestamp}
                        </p>
                        {!isUser && props.provider && (
                            <p className={styles.providerText}>{props.provider}</p>
                        )}
                    </div>
                    {!isUser && props.onPlaySound && (props.audioData || props.message) && (
                        <button 
                            onClick={handlePlaySound} 
                            className={styles.speakerButton}
                            aria-label="Putar suara pesan"
                            disabled={!props.audioData && !props.message}
                        >
                            <SpeakerIcon />
                        </button>
                    )}
                </div>
            </div>
            {isUser && (
                <div className={`${styles.avatar} ${styles.avatarUser}`}>U</div>
            )}
        </div>
    );
};