// src/components/MessageCard.tsx
import React from 'react';

type MessageCardProps = {
    role: "assistant" | "user";
    message: string;
    key?: React.Key;
};

export const MessageCard = (props: MessageCardProps) => {
    return (
        <div
            className={`rounded-lg px-4 py-2 my-1 max-w-xl w-fit whitespace-pre-line shadow-md ${
                props.role === "user"
                    ? "bg-blue-600 text-white self-end"
                    : "bg-slate-200 text-slate-800 self-start"
            }`}
        >
            {props.message}
        </div>
    );
};