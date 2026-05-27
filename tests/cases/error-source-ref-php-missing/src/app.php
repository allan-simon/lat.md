<?php

namespace App;

function greet(string $name): string
{
    return "Hello, $name!";
}

class Greeter
{
    public function greet(string $name): string
    {
        return "Hi, $name!";
    }
}
