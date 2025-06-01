// frontend/src/components/MessageCard.tsx
import React from 'react';
import styles from './MessageCard.module.css'; // Impor CSS Module

type MessageCardProps = {
    role: "assistant" | "user";
    message: string;
    timestamp: string;
};

export const MessageCard = (props: MessageCardProps) => {
    const isUser = props.role === "user";

    return (
        <div className={`${styles.messageWrapper} ${isUser ? styles.user : styles.assistant}`}>
            {/* Avatar Asisten (di kiri) */}
            {!isUser && (
                <div className={`${styles.avatar} ${styles.avatarAssistant}`}>
                    A
                </div>
            )}

            {/* Bubble Pesan dan Timestamp */}
            <div
                className={`
                    ${styles.bubble} 
                    ${isUser ? styles.bubbleUser : styles.bubbleAssistant}
                `}
            >
                <p className={styles.messageText}>{props.message}</p>
                <p className={`${styles.timestamp} ${isUser ? styles.timestampUser : styles.timestampAssistant}`}>
                    {props.timestamp}
                </p>
            </div>

            {/* Avatar Pengguna (di kanan) */}
            {isUser && (
                <div className={`${styles.avatar} ${styles.avatarUser}`}>
                    U
                </div>
            )}
        </div>
    );
};